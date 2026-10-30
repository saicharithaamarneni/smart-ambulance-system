import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  actor: mongoose.Types.ObjectId;
  actorRole: string;
  action: string;
  targetModel?: string;
  targetId?: mongoose.Types.ObjectId;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true },
    targetModel: String,
    targetId: Schema.Types.ObjectId,
    details: { type: Schema.Types.Mixed, default: {} },
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true, capped: { size: 50 * 1024 * 1024, max: 100000 } } // 50MB capped collection
);

AuditLogSchema.index({ actor: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ targetModel: 1, targetId: 1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
