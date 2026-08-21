import express from 'express';
import request from 'supertest';
import {
  IMAGE_UPLOAD_LIMITS,
  uploadPlayerPhoto,
  uploadTeamLogo,
} from '@/middleware/image-upload.middleware';
import { validate, validateObjectIdParam } from '@/middleware/validate.middleware';
import { createPlayerSchema } from '@/validators/player.validator';
import { createTeamSchema, updateTeamSchema } from '@/validators/team.validator';
import Team from '@/models/team.model';
import Player from '@/models/player.model';
import { getManagedCloudinaryPublicId } from '@/utils/cloudinary';

const validTeamInput = {
  name: 'Solid Stars',
  city: 'Enugu',
  captainName: 'Ada Okafor',
  contactPhone: '+2348000000000',
  contactEmail: 'ada@example.com',
};

type NamedSchemaIndex = [
  Record<string, number>,
  { name?: string; [key: string]: unknown },
];

describe('admin input schemas', () => {
  it('retains required contact and registration fields and coerces multipart team values', () => {
    const result = createTeamSchema.parse({
      ...validTeamInput,
      registrationStatus: 'registered',
      foundedYear: '2001',
      colors: '["blue", "white"]',
    });

    expect(result).toMatchObject({
      ...validTeamInput,
      registrationStatus: 'registered',
      foundedYear: 2001,
      colors: ['blue', 'white'],
    });
  });

  it('requires all model-required admin team contact fields', () => {
    expect(() =>
      createTeamSchema.parse({
        name: 'Solid Stars',
        city: 'Enugu',
      })
    ).toThrow();
  });

  it('does not coerce non-numeric JSON values into a founded year', () => {
    expect(() => createTeamSchema.parse({ ...validTeamInput, foundedYear: true })).toThrow();
  });

  it('allows registration and contact fields on PATCH without stripping them', () => {
    const result = updateTeamSchema.parse({
      registrationStatus: 'withdrawn',
      captainName: 'New Captain',
      contactPhone: '+2348111111111',
      contactEmail: 'new@example.com',
    });

    expect(result).toEqual({
      registrationStatus: 'withdrawn',
      captainName: 'New Captain',
      contactPhone: '+2348111111111',
      contactEmail: 'new@example.com',
    });
  });

  it('rejects an empty or unknown-only PATCH instead of reporting a successful no-op', () => {
    expect(() => updateTeamSchema.parse({})).toThrow('At least one team field is required');
    expect(() => updateTeamSchema.parse({ status: 'registered' })).toThrow();
  });

  it('allows team identity and venue fields to be edited', () => {
    expect(
      updateTeamSchema.parse({
        name: 'Renamed United',
        city: 'Nsukka',
        stadium: 'Unity Arena',
        colors: 'blue, white',
        foundedYear: '2012',
      })
    ).toEqual({
      name: 'Renamed United',
      city: 'Nsukka',
      stadium: 'Unity Arena',
      colors: ['blue', 'white'],
      foundedYear: 2012,
    });
  });

  it('preserves an explicit blank founded year so PATCH can clear it', () => {
    const result = updateTeamSchema.parse({ foundedYear: '' });

    expect(Object.prototype.hasOwnProperty.call(result, 'foundedYear')).toBe(true);
    expect(result.foundedYear).toBeUndefined();
  });

  it('defines case-insensitive uniqueness only for active team names', () => {
    const activeNameIndex = (Team.schema.indexes() as NamedSchemaIndex[]).find(
      ([, options]) => options.name === 'one_active_team_name_case_insensitive'
    );

    expect(activeNameIndex).toBeDefined();
    expect(activeNameIndex?.[0]).toEqual({ name: 1 });
    expect(activeNameIndex?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { isDeleted: false },
      collation: { locale: 'en', strength: 2 },
    });
  });

  it('frees a roster slot when a player is soft-deleted', () => {
    const rosterSlotIndex = (Player.schema.indexes() as NamedSchemaIndex[]).find(
      ([, options]) => options.name === 'one_active_player_per_roster_slot'
    );

    expect(rosterSlotIndex?.[0]).toEqual({ teamId: 1, rosterSlot: 1 });
    expect(rosterSlotIndex?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: {
        isDeleted: false,
        rosterSlot: { $type: 'number' },
      },
    });
  });

  it('extracts only SolidFM-owned Cloudinary public IDs for post-replacement cleanup', () => {
    const originalCloudName = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = 'solidfm-cloud';
    try {
      expect(
        getManagedCloudinaryPublicId(
          'https://res.cloudinary.com/solidfm-cloud/image/upload/v123/solidfm/player_passports/passport_ada.jpg'
        )
      ).toBe('solidfm/player_passports/passport_ada');
      expect(
        getManagedCloudinaryPublicId(
          'https://res.cloudinary.com/foreign-cloud/image/upload/v123/solidfm/player_passports/passport_ada.jpg'
        )
      ).toBeUndefined();
      expect(
        getManagedCloudinaryPublicId(
          'https://res.cloudinary.com/solidfm-cloud/raw/upload/v123/solidfm/player_passports/passport_ada.jpg'
        )
      ).toBeUndefined();
      expect(getManagedCloudinaryPublicId('https://example.com/photo.jpg')).toBeUndefined();
    } finally {
      if (originalCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
      else process.env.CLOUDINARY_CLOUD_NAME = originalCloudName;
    }
  });

  it('coerces a decimal multipart jersey number and rejects unsafe numeric strings', () => {
    const validPlayer = {
      name: 'Chidi Nwosu',
      position: 'FW',
      jerseyNumber: '10',
      nationality: 'Nigeria',
      teamId: '507f1f77bcf86cd799439011',
    };

    expect(createPlayerSchema.parse(validPlayer).jerseyNumber).toBe(10);
    expect(() => createPlayerSchema.parse({ ...validPlayer, jerseyNumber: '0x10' })).toThrow();
    expect(() => createPlayerSchema.parse({ ...validPlayer, jerseyNumber: '10abc' })).toThrow();
    expect(() => createPlayerSchema.parse({ ...validPlayer, jerseyNumber: true })).toThrow();
  });

  it('accepts only approved HTTPS hosts for persisted image URLs', () => {
    expect(
      createTeamSchema.parse({
        ...validTeamInput,
        logo: 'https://res.cloudinary.com/solidfm/image/upload/team.png',
      }).logo
    ).toContain('res.cloudinary.com');
    expect(() =>
      createTeamSchema.parse({
        ...validTeamInput,
        logo: 'https://untrusted.example/team.png',
      })
    ).toThrow();

    const validPlayer = {
      name: 'Chidi Nwosu',
      position: 'FW',
      jerseyNumber: 10,
      nationality: 'Nigeria',
      teamId: '507f1f77bcf86cd799439011',
    };
    expect(
      createPlayerSchema.parse({
        ...validPlayer,
        passportPic: 'https://res.cloudinary.com/solidfm/image/upload/player.webp',
      }).passportPic
    ).toContain('res.cloudinary.com');
    expect(() =>
      createPlayerSchema.parse({
        ...validPlayer,
        passportPic: 'http://res.cloudinary.com/solidfm/player.jpg',
      })
    ).toThrow();
  });
});

describe('image upload middleware', () => {
  const buildApp = () => {
    const app = express();
    app.post('/upload', uploadTeamLogo, (req, res) => {
      res.status(200).json({ success: true, mimeType: req.file?.mimetype });
    });
    return app;
  };

  it('accepts a supported image whose signature matches its MIME type', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const response = await request(buildApp())
      .post('/upload')
      .attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, mimeType: 'image/png' });
  });

  it('rejects unsupported declared MIME types', async () => {
    const response = await request(buildApp())
      .post('/upload')
      .attach('logo', Buffer.from('not an image'), {
        filename: 'logo.svg',
        contentType: 'image/svg+xml',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('JPEG, PNG, and WebP');
  });

  it('rejects content that is disguised with an allowed MIME type', async () => {
    const response = await request(buildApp())
      .post('/upload')
      .attach('logo', Buffer.from('not a png'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('does not match');
  });

  it('returns 413 when a team logo exceeds one MiB', async () => {
    const oversizedPng = Buffer.alloc(IMAGE_UPLOAD_LIMITS.teamLogo + 1);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPng);

    const response = await request(buildApp())
      .post('/upload')
      .attach('logo', oversizedPng, { filename: 'large.png', contentType: 'image/png' });

    expect(response.status).toBe(413);
    expect(response.body.message).toContain('1MB');
  });

  it('keeps an in-memory logo available after team body validation', async () => {
    const app = express();
    app.post('/teams', uploadTeamLogo, validate(createTeamSchema), (req, res) => {
      res.status(200).json({
        success: true,
        registrationStatus: req.body.registrationStatus,
        foundedYear: req.body.foundedYear,
        hasBuffer: Buffer.isBuffer(req.file?.buffer),
        tempPath: (req.file as Express.Multer.File & { path?: string } | undefined)?.path,
      });
    });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await request(app)
      .post('/teams')
      .field('name', validTeamInput.name)
      .field('city', validTeamInput.city)
      .field('captainName', validTeamInput.captainName)
      .field('contactPhone', validTeamInput.contactPhone)
      .field('contactEmail', validTeamInput.contactEmail)
      .field('registrationStatus', 'registered')
      .field('foundedYear', '2001')
      .attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      registrationStatus: 'registered',
      foundedYear: 2001,
      hasBuffer: true,
    });
    expect(response.body.tempPath).toBeUndefined();
  });

  it('keeps an in-memory player photo while coercing multipart jerseyNumber', async () => {
    const app = express();
    app.post('/players', uploadPlayerPhoto, validate(createPlayerSchema), (req, res) => {
      res.status(200).json({
        success: true,
        jerseyNumber: req.body.jerseyNumber,
        hasBuffer: Buffer.isBuffer(req.file?.buffer),
      });
    });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const response = await request(app)
      .post('/players')
      .field('name', 'Chidi Nwosu')
      .field('position', 'FW')
      .field('jerseyNumber', '10')
      .field('nationality', 'Nigeria')
      .field('teamId', '507f1f77bcf86cd799439011')
      .attach('passportPic', jpeg, { filename: 'player.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, jerseyNumber: 10, hasBuffer: true });
  });
});

describe('object ID middleware', () => {
  const app = express();
  app.get('/teams/:id', validateObjectIdParam('id', 'team'), (_req, res) => {
    res.status(200).json({ success: true });
  });

  it('rejects malformed IDs before a controller or model query', async () => {
    const response = await request(app).get('/teams/not-an-object-id');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: 'Invalid team ID' });
  });

  it('allows canonical 24-character hex IDs', async () => {
    const response = await request(app).get('/teams/507f1f77bcf86cd799439011');

    expect(response.status).toBe(200);
  });
});
