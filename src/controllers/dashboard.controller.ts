import { Request, Response } from 'express';
import Team from '@/models/team.model';
import Match from '@/models/match.model';
import Player from '@/models/player.model';
import Admin from '@/models/admin.model';
import logger from '@/utils/logger';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const isAdmin = user.role === 'admin' || user.role === 'super_admin';
    const isSuperAdmin = user.role === 'super_admin';

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const [
      totalTeams,
      pendingTeams,
      totalMatches,
      totalPlayers,
      pendingAdmins
    ] = await Promise.all([
      Team.countDocuments({ isDeleted: false }),
      Team.countDocuments({ registrationStatus: 'pending', isDeleted: false }),
      Match.countDocuments({ isDeleted: false }),
      Player.countDocuments({ isDeleted: false }),
      isSuperAdmin ? Admin.countDocuments({ isVerified: false }) : Promise.resolve(0)
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalTeams,
        pendingTeams,
        totalMatches,
        totalPlayers,
        pendingAdmins: isSuperAdmin ? pendingAdmins : undefined
      }
    });
  } catch (error: any) {
    logger.error('Dashboard Stats Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
};
