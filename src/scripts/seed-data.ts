import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import Team from '../models/team.model';
import Player, { PlayerPosition } from '../models/player.model';
import Match from '../models/match.model';
import Standings from '../models/standings.model';
import PlayerStats from '../models/player-stats.model';
import Tournament from '../models/tournament.model';

dotenv.config();

// Fix for Atlas DNS issues
dns.setServers(['8.8.8.8', '8.8.4.4']);

const TEAMS = [
  { name: 'Enugu Stars', city: 'Enugu', colors: ['Blue', 'White'] },
  { name: 'Lagos Lions', city: 'Lagos', colors: ['Red', 'Gold'] },
  { name: 'Abuja United', city: 'Abuja', colors: ['Green', 'White'] },
  { name: 'Kano Pillars Elite', city: 'Kano', colors: ['Yellow', 'Green'] },
  { name: 'Port Harcourt FC', city: 'Port Harcourt', colors: ['Blue', 'Black'] },
  { name: 'Ibadan Warriors', city: 'Ibadan', colors: ['Maroon', 'White'] },
  { name: 'Benin City Rovers', city: 'Benin City', colors: ['Orange', 'Black'] },
  { name: 'Jos Miners', city: 'Jos', colors: ['Purple', 'White'] },
  { name: 'Kaduna Kings', city: 'Kaduna', colors: ['Red', 'White'] },
  { name: 'Warri Wolves 5s', city: 'Warri', colors: ['Blue', 'Yellow'] },
  { name: 'Calabar Rovers', city: 'Calabar', colors: ['Green', 'Black'] },
  { name: 'Uyo City', city: 'Uyo', colors: ['Orange', 'White'] },
  { name: 'Asaba Dynamos', city: 'Asaba', colors: ['Pink', 'Black'] },
  { name: 'Owerri Spartans', city: 'Owerri', colors: ['Red', 'Black'] },
  { name: 'Awa Boys', city: 'Awka', colors: ['Yellow', 'Blue'] },
  { name: 'Zaria Knights', city: 'Zaria', colors: ['Silver', 'Black'] },
  { name: 'Sokoto Sultans', city: 'Sokoto', colors: ['Gold', 'Green'] },
  { name: 'Ilorin Chiefs', city: 'Ilorin', colors: ['Blue', 'Red'] },
  { name: 'Makurdi Stars', city: 'Makurdi', colors: ['White', 'Black'] },
  { name: 'Minna Falcons', city: 'Minna', colors: ['Green', 'Orange'] },
  { name: 'Lokoja Jets', city: 'Lokoja', colors: ['Blue', 'Silver'] },
  { name: 'Abeokuta Rocks', city: 'Abeokuta', colors: ['Brown', 'Orange'] },
  { name: 'Akure Blazers', city: 'Akure', colors: ['Red', 'Yellow'] },
  { name: 'Oshogbo Giants', city: 'Oshogbo', colors: ['Purple', 'Gold'] },
  { name: 'Ado-Ekiti Eagles', city: 'Ado-Ekiti', colors: ['Green', 'Gold'] },
  { name: 'Umuahia Patriots', city: 'Umuahia', colors: ['Blue', 'Green'] },
  { name: 'Yenagoa Mariners', city: 'Yenagoa', colors: ['Cyan', 'Black'] },
  { name: 'Bauchi Bulls', city: 'Bauchi', colors: ['Yellow', 'Purple'] },
];

const FIRST_NAMES = ['Kola', 'Chuka', 'Emeka', 'Samuel', 'Ahmed', 'Victor', 'Idris', 'David', 'Musa', 'Tunde', 'Alex', 'Kenneth'];
const LAST_NAMES = ['Adebayo', 'Okafor', 'Ibrahim', 'Eze', 'Danfulani', 'Okeke', 'Aliyu', 'Nwachukwu', 'Ogunleye', 'Obi', 'Lawal', 'Uba'];

const getRandomName = () => {
    return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;
};

const getRandomPositions = () => {
    // 5-a-side realistic composition
    return [PlayerPosition.GOALKEEPER, PlayerPosition.DEFENDER, PlayerPosition.MIDFIELDER, PlayerPosition.MIDFIELDER, PlayerPosition.FORWARD];
};

const seedDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
       console.error('MONGODB_URI not set');
       process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB. Beginning Seeding...');

    // Wipe existing data just in case
    await Team.deleteMany({});
    await Player.deleteMany({});
    await Match.deleteMany({});
    await Standings.deleteMany({});
    await PlayerStats.deleteMany({});
    await Tournament.deleteMany({});

    let playersCreated = 0;

    for (let i = 0; i < TEAMS.length; i++) {
        const teamInfo = TEAMS[i];
        
        // Use abstract geometric placeholders for team logos if dummy url gets boring
        const teamInitials = teamInfo.name.substring(0,2).toUpperCase();
        const logoUrl = `https://ui-avatars.com/api/?name=${teamInitials}&background=random&color=fff&size=200&bold=true`;

        const newTeam = await Team.create({
            name: teamInfo.name,
            city: teamInfo.city,
            colors: teamInfo.colors,
            logo: logoUrl,
            captainName: getRandomName(),
            contactPhone: '08000000000',
            contactEmail: `team${i}@example.com`,
            registrationStatus: 'registered', // approved implicitly
        });

        // Seed 5 starting players for each team
        const positions = getRandomPositions();
        for (let j = 0; j < 5; j++) {
            const pName = getRandomName();
            const pImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(pName)}&background=random&color=fff&size=150&rounded=true`;
            await Player.create({
                name: pName,
                position: positions[j],
                jerseyNumber: j === 0 ? 1 : Math.floor(Math.random() * 98) + 2,
                nationality: 'Nigeria',
                teamId: newTeam._id,
                passportPic: pImage
            });
            playersCreated++;
        }
        console.log(`Successfully seeded ${teamInfo.name} and 5 squad players.`);
    }

    console.log(`\n✅ Seeding Complete!`);
    console.log(`Total Teams: ${TEAMS.length}`);
    console.log(`Total Players: ${playersCreated}`);
    process.exit(0);

  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
};

seedDB();
