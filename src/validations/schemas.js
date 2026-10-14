import { z } from 'zod';

const money = z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(0, 'No puede ser negativo').max(1e12);
const text = (max = 200) => z.string().trim().min(1, 'Requerido').max(max);
const optText = (max = 1000) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const id = z.string().min(1).max(40);

export const registerSchema = z.object({
  name: text(120),
  email: z.string().trim().toLowerCase().email('Correo inválido').max(160),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(128),
  phone: z.string().trim().max(30).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  password: z.string().min(1, 'Requerido').max(128),
});

export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email('Correo inválido') });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8, 'Mínimo 8 caracteres').max(128),
});

export const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  openingNetWorth: money.optional(),
});

export const periodQuery = z.object({ periodId: id });

export const incomeSchema = z.object({
  periodId: id,
  category: z.enum(['SALARIO', 'NEGOCIO', 'RENTAS', 'DIVIDENDOS', 'INTERESES', 'OTROS']),
  description: text(),
  amount: money,
});

export const expenseSchema = z.object({
  periodId: id,
  category: z.enum([
    'VIVIENDA', 'ALIMENTACION', 'SERVICIOS', 'TRANSPORTE', 'SEGUROS',
    'EDUCACION', 'ENTRETENIMIENTO', 'VIAJES', 'DEUDAS', 'OTROS',
  ]),
  description: text(),
  amount: money,
});

export const protectionSchema = z.object({
  periodId: id,
  type: z.enum(['LIQUIDEZ', 'FONDO_EMERGENCIA', 'RESERVA', 'SEGURO_GASTOS_MEDICOS', 'SEGURO_VIDA', 'OTRO_SEGURO']),
  name: text(),
  amount: money,
  notes: optText(),
});

export const debtSchema = z.object({
  periodId: id,
  name: text(),
  lender: optText(120),
  annualRate: z.coerce.number().min(0).max(1000),
  status: z.enum(['ACTIVE', 'PAID']).default('ACTIVE'),
  balance: money,
  payment: money,
});

export const assetSchema = z.object({
  periodId: id,
  categoryCode: text(40),
  name: text(),
  institution: optText(120),
  notes: optText(),
  initialCapital: money,
  finalCapital: money,
});

export const movementSchema = z.object({
  periodId: id,
  type: z.enum(['APORTACION', 'DEDUCCION']),
  amount: z.coerce.number().positive('Debe ser mayor a 0').max(1e12),
  // Fecha calendario: se fija al mediodía UTC para que no cambie de día por zona horaria.
  date: z.coerce.date().transform((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12))),
  description: text(),
  assetId: id.optional().nullable(),
});

export const businessFlowSchema = z.object({
  periodId: id,
  assetId: id,
  revenue: money,
  costs: money,
  notes: optText(),
});

export const progressSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED']),
  exercise: optText(5000),
});

const pctField = z.coerce.number().min(-100).max(1000);
export const toolSchemas = {
  'rendimiento-neto': z.object({
    capital: money,
    returnRate: pctField,
    commissions: money.default(0),
    otherCosts: money.default(0),
    taxRate: z.coerce.number().min(0).max(100).default(0),
  }),
  'poder-adquisitivo': z.object({
    amount: money,
    years: z.coerce.number().int().min(0).max(60),
    inflationRate: z.coerce.number().min(-50).max(500),
    nominalRate: pctField.default(0),
  }),
};

export const adminLevelSchema = z.object({ adminLevel: z.enum(['VIEW', 'EDIT', 'FULL']), reason: text(500) });

export const createAdminSchema = z.object({
  name: text(120),
  email: z.string().trim().toLowerCase().email('Correo inválido').max(160),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(128),
  adminLevel: z.enum(['VIEW', 'EDIT', 'FULL']),
});

export const appointmentSchema = z.object({
  reason: text(500),
  scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), 'La fecha debe ser futura'),
  durationMin: z.coerce.number().int().min(15).max(240).default(60),
  channel: z.enum(['VIDEOLLAMADA', 'LLAMADA', 'WHATSAPP', 'PRESENCIAL']),
  notes: optText(),
});

export const appointmentAdminSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  scheduledAt: z.coerce.date().optional(),
  durationMin: z.coerce.number().int().min(15).max(240).optional(),
  adminNotes: optText(),
});

export const reasonSchema = z.object({ reason: text(500) });

export const adminSubscriptionSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED']),
  reason: text(500),
});

export const adminUserSchema = z.object({ isActive: z.boolean(), reason: text(500) });

export const openingSchema = z.object({ openingNetWorth: money.nullable() });
export const yearParam = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
export const historyQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
