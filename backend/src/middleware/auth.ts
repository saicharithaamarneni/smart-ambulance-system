import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../models/User';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    name: string;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'fallback_secret';

    let decoded: any;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        res.status(401).json({ success: false, message: 'Token expired. Please log in again.' });
        return;
      }
      res.status(401).json({ success: false, message: 'Invalid token.' });
      return;
    }

    const user = await User.findById(decoded.id).select('name email role isActive');
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'User not found or account deactivated.' });
      return;
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}.`,
      });
      return;
    }
    next();
  };
};

export const generateToken = (payload: { id: string; email: string; role: string }): string => {
  const secret = process.env.JWT_SECRET || 'fallback_secret';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
};

export const verifySocketToken = (token: string): any => {
  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
};
