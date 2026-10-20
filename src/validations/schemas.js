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
  acceptLegal: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los Términos y el Aviso de privacidad' }) }),
  legalVersion: z.string().trim().min(1).max(20),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  password: z.string().min(1, 'Requerido').max(128),
});

const emailField = z.string().trim().toLowerCase().email('Correo inválido');
const totpCode = z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos');
const challenge = z.string().min(20).max(1000);

export const codeLoginSchema = z.object({ email: emailField, code: totpCode });
export const challengeSchema = z.object({ challengeToken: challenge });
export const activateTwoFactorSchema = z.object({ challengeToken: challenge, code: totpCode });
export const resetWithCodeSchema = z.object({ email: emailField, code: totpCode, password: z.string().min(8, 'Mínimo 8 caracteres').max(128) });
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

const DEBT_TYPES = ['TARJETA_CREDITO', 'PRESTAMO_PERSONAL', 'CREDITO_AUTOMOTRIZ', 'HIPOTECA', 'CREDITO_NOMINA', 'PRESTAMO_FAMILIAR', 'BNPL', 'DEUDA_NEGOCIO', 'IMPUESTOS', 'OTRA'];
const blankToNull = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
const nullableNumber = (min, max) => z.preprocess(blankToNull, z.number({ invalid_type_error: 'Debe ser un número' }).min(min).max(max).nullable());

export const debtFields = z.object({
  name: text(),
  lender: optText(120),
  type: z.enum(DEBT_TYPES).default('OTRA'),
  annualRate: nullableNumber(0, 1000),
  status: z.enum(['ACTIVE', 'PAID']).default('ACTIVE'),
  balance: money,
  payment: money,
  fees: money.default(0),
});

export const debtSchema = debtFields.extend({ periodId: id });

export const debtPaymentSchema = z.object({
  amount: z.coerce.number().positive('Debe ser mayor a 0').max(1e12),
  newBalance: nullableNumber(0, 1e12).optional(),
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

export const adminUserSchema = z.object({ isActive: z.boolean(), reason: text(500) });

export const openingSchema = z.object({ openingNetWorth: money.nullable() });
export const yearParam = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
export const historyQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

const enumOf = (values) => z.enum(values);
const amount = money.default(0);

export const diagnosisSchema = z.object({
  income: amount,
  expenses: amount,
  debtPayment: amount,
  monthlyInvestment: amount,
  cash: amount,
  investments: amount,
  otherAssets: amount,
  totalDebt: amount,
  emergencyFund: amount,
  riskTolerance: enumOf(['CONSERVADOR', 'MODERADO', 'ALTO']),
  mainGoal: enumOf(['CONSTRUIR_PATRIMONIO', 'FONDO_EMERGENCIA', 'INVERTIR_MEJOR', 'REDUCIR_DEUDAS']),
});

export const productSchema = z.object({
  name: text(120),
  productType: enumOf(['RENTA_FIJA', 'RENTA_VARIABLE', 'FONDOS', 'ACCIONES', 'BIENES_RAICES', 'NEGOCIO', 'ACTIVO_DIGITAL', 'LIQUIDEZ']),
  capital: z.coerce.number().positive('Captura un monto mayor a 0').max(1e12),
  horizon: enumOf(['CORTO', 'MEDIANO', 'LARGO']),
  liquidityLevel: enumOf(['ALTA', 'MEDIA', 'BAJA']),
  perceivedRisk: enumOf(['BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO']),
});

export const moduleProgressSchema = z.object({
  status: enumOf(['IN_PROGRESS', 'COMPLETED']),
  exercise: z.string().trim().max(5000).optional(),
});

export const routeSchema = z.object({ route: enumOf(['MARKETS', 'PATRIMONIAL']) });

const binary = z.coerce.number().int().min(0).max(1);
export const marketFilterSchema = z.object({ answers: z.object({ q1: binary, q2: binary, q3: binary, q4: binary, q5: binary, q6: binary }) });

const leverage = z.coerce.number().refine((v) => [1, 2, 5, 10, 25, 50, 100, 150].includes(v), 'Apalancamiento no válido');
const positive = z.coerce.number().min(0).max(1e12);

export const simulationSchemas = {
  3: z.object({
    RENTA_FIJA: amount, RENTA_VARIABLE: amount, BIENES_RAICES: amount, NEGOCIOS: amount, LIQUIDEZ: amount, ALTO_RIESGO: amount,
  }),
  4: z.object({ capital: positive, direction: enumOf(['LONG', 'SHORT']), leverage, movePct: z.coerce.number().min(0).max(100), favorable: z.boolean() }),
  5: z.object({
    capital: positive,
    direction: enumOf(['LONG', 'SHORT']),
    leverage,
    entryPrice: z.coerce.number().positive().max(1e12),
    exitPrice: z.coerce.number().positive().max(1e12),
    costPct: z.coerce.number().min(0).max(10),
  }),
  6: z.object({
    capital: positive,
    riskPct: z.coerce.number().min(0).max(100),
    positions: z.coerce.number().int().min(1).max(100),
    leverage,
    automation: enumOf(['MANUAL', 'SEMI', 'AUTO']),
    monitoring: enumOf(['BASIC', 'CONTINUOUS', 'ALERTS']),
  }),
};

export const offerUpdateSchema = z.object({
  name: text(120),
  description: optText(500),
  price: z.coerce.number().min(0).max(1e9).nullable(),
  currency: z.string().trim().toUpperCase().length(3),
  accessDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  active: z.boolean(),
});

export const grantSchema = z.object({ offerCode: text(40), reason: text(500) });

const cta = z.string().trim().max(80).optional().nullable().transform((v) => v || null);
export const publicSectionSchema = z.object({
  navLabel: text(40),
  active: z.boolean(),
  eyebrow: optText(120),
  title: text(160),
  highlight: optText(80),
  subtitle: optText(300),
  description: optText(900),
  secondaryText: optText(600),
  primaryCtaLabel: cta,
  primaryCtaTarget: cta,
  secondaryCtaLabel: cta,
  secondaryCtaTarget: cta,
  items: z.array(z.object({ title: text(120), text: optText(400), tag: optText(40) })).max(12).optional().nullable(),
});

export const reorderSchema = z.object({ keys: z.array(z.string().min(1).max(40)).min(1).max(30) });

export const analyticsEventSchema = z.object({
  event: z.string().min(1).max(40),
  sessionId: z.string().max(64).optional(),
  path: z.string().max(120).optional(),
  metadata: z.record(z.union([z.string().max(60), z.number(), z.boolean()])).optional(),
});

export const mediaUpdateSchema = z.object({ active: z.boolean().optional(), position: z.coerce.number().int().min(0).max(999).optional(), name: text(160).optional() });

const BUDGET_CATEGORIES = ['VIVIENDA', 'ALIMENTACION', 'SERVICIOS', 'TRANSPORTE', 'SEGUROS', 'EDUCACION', 'ENTRETENIMIENTO', 'VIAJES', 'DEUDAS', 'OTROS', 'AHORRO', 'INVERSION'];
const yearField = z.coerce.number().int().min(2000).max(2100);
const monthField = z.coerce.number().int().min(1).max(12);

export const monthQuery = z.object({ year: yearField, month: monthField });

export const budgetSchema = z.object({
  year: yearField,
  month: monthField,
  netIncome: money,
  lines: z
    .array(z.object({ category: z.enum(BUDGET_CATEGORIES), percent: z.coerce.number().min(0, 'No puede ser negativo').max(100) }))
    .min(1)
    .max(BUDGET_CATEGORIES.length)
    .refine((lines) => new Set(lines.map((l) => l.category)).size === lines.length, 'Categorías repetidas'),
});

export const budgetActualSchema = z.object({
  year: yearField,
  month: monthField,
  category: z.enum(BUDGET_CATEGORIES.filter((c) => c !== 'INVERSION')),
  amount: z.coerce.number().positive('Debe ser mayor a 0').max(1e12),
  description: text(),
});

export const emergencyPlanSchema = z.object({
  targetMonths: z.coerce.number().int().min(1, 'La meta debe ser mayor que cero').max(60),
  monthlyContribution: money,
  declaredEssential: nullableNumber(0, 1e12).optional(),
  useDeclared: z.boolean().default(false),
});

export const contributionSchema = z.object({
  destination: z.enum(['FONDO_EMERGENCIA', 'AHORRO']).default('FONDO_EMERGENCIA'),
  amount: z.coerce.number().positive('Debe ser mayor a 0').max(1e12),
  description: text(),
});

const signedMoney = z.coerce.number({ invalid_type_error: 'Debe ser un número' }).min(-1e12).max(1e12);
const optionalId = z.preprocess((v) => (v === '' || v === undefined ? null : v), id.nullable());

export const taxItemSchema = z.object({
  name: text(120),
  type: z.enum(['NEGOCIO', 'INVERSION_FINANCIERA', 'BIEN_INMUEBLE', 'RENTA_ACTIVOS', 'PARTICIPACION_EMPRESA', 'CRIPTOACTIVOS', 'OTRA']),
  period: z.enum(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO']),
  capital: money,
  grossProfit: signedMoney,
  commissions: money,
  otherCosts: money,
  taxRate: z.coerce.number().min(0, 'Entre 0% y 100%').max(100, 'Entre 0% y 100%'),
  sourceAssetId: optionalId,
});

const scenarioRate = z.coerce.number().gt(-100, 'Debe ser mayor que -100%').max(1000);

export const scenarioSchema = z.object({
  name: text(120),
  type: z.enum(['AHORRO', 'INVERSION', 'META', 'EFECTIVO', 'OTRO']),
  capital: money,
  years: z.coerce.number().int('Usa años completos').min(0).max(100),
  inflationRate: scenarioRate,
  nominalRate: scenarioRate,
  sourceAssetId: optionalId,
  sourceGoalId: optionalId,
});

export const patrimonialGoalSchema = z.object({
  name: optText(120),
  targetAmount: z.coerce.number().positive('Debe ser mayor a 0').max(1e13),
});

export const reviewNoteSchema = z.object({ note: z.string().trim().max(5000) });

const LEAD_INTERESTS = ['EDUCACION_FINANCIERA', 'TRADING_ACADEMY', 'COPYTRADING', 'GENERAL'];

export const leadSchema = z.object({
  name: text(120),
  email: z.string().trim().toLowerCase().email('Correo inválido').max(160),
  phone: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  interest: z.enum(LEAD_INTERESTS),
  message: optText(1000),
  sourcePath: z.string().trim().max(120).optional().nullable(),
  sessionId: z.string().max(64).optional(),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar el Aviso de privacidad' }) }),
});

export const leadUpdateSchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CLOSED']),
  adminNotes: optText(1000),
});

export const leadQuery = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'CLOSED']).optional(),
  interest: z.enum(LEAD_INTERESTS).optional(),
});
