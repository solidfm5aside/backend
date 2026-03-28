import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import Team from '../models/team.model';
import Player from '../models/player.model';
import Match from '../models/match.model';
import Standings from '../models/standings.model';
import Tournament from '../models/tournament.model';

dotenv.config();

// Fix for Atlas DNS issues
dns.setServers(['8.8.8.8', '8.8.4.4']);

const wipeDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
       console.error('MONGODB_URI not set');
       process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB...');

    const teamRes = await Team.deleteMany({});
    const playerRes = await Player.deleteMany({});
    const matchRes = await Match.deleteMany({});
    const standingsRes = await Standings.deleteMany({});
    const tournamentRes = await Tournament.deleteMany({});

    console.log(`Deleted ${teamRes.deletedCount} teams.`);
    console.log(`Deleted ${playerRes.deletedCount} players.`);
    console.log(`Deleted ${matchRes.deletedCount} matches.`);
    console.log(`Deleted ${standingsRes.deletedCount} standings.`);
    console.log(`Deleted ${tournamentRes.deletedCount} tournaments.`);

    console.log('Successfully wiped db to prepare for Season 1.');
    process.exit(0);
  } catch (err) {
    console.error('Wipe failed:', err);
    process.exit(1);
  }
};

wipeDB();
