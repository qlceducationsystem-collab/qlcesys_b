const section = (title, ...paragraphs) => ({ title, paragraphs });

export const BLOCK_2 = [
  {
    month: 7,
    title: 'Presupuesto y control financiero',
    summary: 'Planea cómo distribuir tu ingreso y compáralo con tus movimientos reales del mes.',
    content: {
      tool: { name: 'Presupuesto y control financiero', question: '¿Cómo estoy utilizando mi dinero y cómo puedo organizarlo mejor?' },
      essentials: [
        'Define el mes, tu ingreso neto y el porcentaje de cada categoría. Los porcentajes deben sumar 100%.',
        'Los importes reales se leen de Ingresos y gastos: no capturas dos veces el mismo movimiento.',
        'El ahorro y la inversión planeados son objetivos: no crean activos ni ahorro acumulado.',
      ],
      riskNotes: ['Los porcentajes iniciales son un ejemplo educativo editable, no una regla universal ni una recomendación personalizada.'],
      lesson: [
        section(
          'Del conocimiento a la organización',
          'El Bloque 2 cambia de enfoque: después de conocer tus finanzas (M1–M3) empiezas a organizar tu dinero, planear cómo distribuirlo y comparar tus planes con lo que realmente ocurre cada mes.',
          'La lógica es: definir ingresos → distribuir presupuesto → registrar importes reales → comparar resultados → preparar el cierre mensual.',
        ),
        section(
          'Importe planeado',
          'Importe planeado = ingreso mensual neto × porcentaje planeado / 100. Con un ingreso de $30,000 y 25% para vivienda, el límite planeado es $7,500.',
          'Distribución inicial de ejemplo: vivienda 25%, alimentación 12%, transporte 8%, entretenimiento 7%, deudas 10%, ahorro 20% e inversión 18%. Puedes modificarla según tu situación.',
        ),
        section(
          'Diferencia frente al plan',
          'Diferencia = importe planeado − importe real. Si planeaste $7,500 en vivienda y registraste $9,000, la desviación es −$1,500: superaste el límite. Si registraste $7,000, quedan +$500 respecto al plan.',
          'En ahorro e inversión la diferencia indica cuánto falta para cumplir el objetivo, no un gasto excedido.',
        ),
        section(
          'Gastos, ahorro, inversión y saldo estimado',
          'Los gastos planeados suman vivienda, alimentación, transporte, entretenimiento y deudas. El ahorro y la inversión se muestran por separado para no confundirlos con el consumo.',
          'Saldo estimado = ingreso neto − suma de todos los importes reales registrados. Es una estimación: no equivale al saldo bancario ni al patrimonio.',
        ),
        section(
          'Plan no es movimiento',
          'Planear $6,000 de ahorro no significa tenerlos ahorrados. Planear $5,400 de inversión no crea un activo. Planear un pago de deuda no la reduce. Solo los movimientos confirmados modifican tu realidad financiera.',
        ),
      ],
      exercise: {
        prompt: 'Construye el presupuesto de este mes, compáralo con tus movimientos reales y escribe en qué categoría te desviaste más y por qué.',
        steps: ['Define el mes y tu ingreso neto.', 'Ajusta los porcentajes hasta sumar 100% y guarda.', 'Revisa los importes reales leídos de Ingresos y gastos.', 'Identifica desviaciones y registra tus conclusiones.'],
      },
    },
  },
  {
    month: 8,
    title: 'Fondo de emergencia y liquidez',
    summary: 'Mide cuántos meses de gastos esenciales cubre tu liquidez real y define una meta de reserva.',
    content: {
      tool: { name: 'Fondo de emergencia y liquidez', question: 'Si mañana dejaras de recibir ingresos o tuvieras un imprevisto, ¿cuánto tiempo podrías mantener tus gastos esenciales con el dinero disponible?' },
      essentials: [
        'Tus gastos esenciales se calculan con tus movimientos reales o tu presupuesto; tu liquidez proviene de Patrimonio y Protección.',
        'La meta (1, 3, 6, 9 o 12 meses) y la aportación mensual son objetivos: no aumentan tu liquidez ni tu patrimonio.',
        'Solo una aportación confirmada actualiza tu fondo de emergencia.',
      ],
      riskNotes: ['La cantidad adecuada depende de la estabilidad de tus ingresos, responsabilidades, seguros y otras circunstancias. Las metas son referencias educativas.'],
      lesson: [
        section(
          'Liquidez para imprevistos',
          'Después de organizar tu dinero (M7) identificas cuánto tienes realmente disponible para afrontar imprevistos y cuánto necesitarías para cubrir tus gastos esenciales durante un periodo determinado.',
          'No incluyas inversiones volátiles ni activos que no puedas convertir rápidamente en efectivo sin asumir un riesgo importante.',
        ),
        section(
          'Meses cubiertos y reserva objetivo',
          'Meses cubiertos = dinero líquido disponible / gastos esenciales mensuales. Con $36,000 y gastos esenciales de $18,000, cubres 2 meses.',
          'Reserva objetivo = gastos esenciales × meses de la meta. Con una meta de 3 meses: $18,000 × 3 = $54,000.',
        ),
        section(
          'Faltante, avance y plazo',
          'Faltante = máximo entre cero y (reserva objetivo − dinero líquido). En el ejemplo faltan $18,000 y el avance es 66.7%.',
          'Meses estimados = redondear hacia arriba (faltante / aportación mensual). Con $2,000 al mes tardarías 9 meses, suponiendo que no uses la reserva y que los gastos no cambien.',
        ),
        section(
          'Plan frente a realidad',
          'La liquidez disponible es un dato real. La reserva objetivo y la aportación planeada son metas. La aportación realizada es un movimiento real que se registra una sola vez.',
        ),
      ],
      exercise: {
        prompt: 'Define tu meta de reserva y explica qué cambiarías para alcanzarla en menos tiempo.',
        steps: ['Revisa tus gastos esenciales y tu liquidez real.', 'Elige una meta en meses y tu aportación mensual planeada.', 'Guarda tu meta.', 'Registra tus conclusiones.'],
      },
    },
  },
  {
    month: 9,
    title: 'Deudas y costo del dinero',
    summary: 'Concentra tus obligaciones, estima su costo mensual y compáralo con tus ingresos.',
    content: {
      tool: { name: 'Panel de obligaciones', question: '¿Cuánto debo, cuánto pago al mes y cuánto me cuestan mis deudas?' },
      essentials: [
        'Tus obligaciones son las mismas deudas de Patrimonio: aparecen como pasivos sin duplicarse.',
        'Los intereses y la aportación a capital son estimaciones; planear un pago no reduce el saldo.',
        'Al confirmar un pago se registra un gasto real en Ingresos y gastos.',
      ],
      riskNotes: ['La fórmula de interés es simplificada (saldo × tasa anual / 12) y no necesariamente coincide con tu estado de cuenta.', 'La proporción pagos/ingreso es descriptiva: no es una calificación crediticia ni una recomendación.'],
      lesson: [
        section(
          'Una sola vista de tus obligaciones',
          'Tarjetas, préstamos, créditos automotrices, hipotecas, créditos de nómina, préstamos familiares, compras a meses, deudas de negocio o impuestos pendientes: el panel los reúne y los convierte en indicadores fáciles de interpretar.',
        ),
        section(
          'Costo mensual estimado',
          'Interés mensual estimado = saldo × (tasa anual / 100) / 12. Una tarjeta con saldo de $28,000 y tasa de 42% genera un interés estimado de $980 al mes.',
          'Costo mensual = interés + cargos mensuales. Con $150 de cargos, el costo estimado es $1,130.',
        ),
        section(
          'Aportación estimada a capital',
          'Aportación estimada = pago planeado − interés − cargos. Con un pago de $3,500 quedarían aproximadamente $2,370 para reducir el capital.',
          'Si el resultado es negativo, el pago planeado podría no cubrir el costo mensual estimado. Si no conoces la tasa, el cálculo queda incompleto: una tasa desconocida no es 0%.',
        ),
        section(
          'Pagos respecto al ingreso',
          'Proporción = pagos mensuales planeados / ingreso mensual neto × 100. Con pagos de $7,500 e ingreso de $30,000, el 25% de tu ingreso está comprometido.',
        ),
      ],
      exercise: {
        prompt: '¿Qué obligación tiene el mayor costo mensual estimado y qué podrías hacer para reducirlo?',
        steps: ['Registra o revisa tus obligaciones.', 'Completa las tasas que conozcas.', 'Revisa el costo estimado y la aportación a capital.', 'Registra tus conclusiones.'],
      },
    },
  },
  {
    month: 10,
    title: 'Impuestos y costo real',
    summary: 'Estima cuánto queda de tus negocios e inversiones después de comisiones, costos e impuestos.',
    content: {
      tool: { name: 'Calculadora de rendimiento neto', question: '¿Cuánto gano realmente con cada negocio o inversión después de costos e impuestos estimados?' },
      essentials: [
        'Registra cada negocio o inversión con su capital, ganancia bruta, comisiones, otros costos, tasa estimada y periodo.',
        'Los resultados son estimaciones: no modifican tus activos, ingresos ni gastos reales.',
        'El rendimiento consolidado solo es comparable cuando los registros usan periodos compatibles.',
      ],
      riskNotes: [
        'La tasa de impuesto es un supuesto introducido por ti: no es universal ni determina el impuesto oficial.',
        'La base fiscal real depende de la jurisdicción, actividad, instrumento, deducciones, retenciones, pérdidas y reglas aplicables. QLC no sustituye la asesoría fiscal profesional.',
      ],
      lesson: [
        section(
          'Bruto no es neto',
          'Una actividad puede generar una ganancia bruta atractiva y, después de comisiones, costos e impuestos, dejar un resultado muy distinto. Este módulo te enseña a separar ambos conceptos.',
        ),
        section(
          'El cálculo paso a paso',
          'Costos = comisiones + otros costos. Ganancia antes de impuestos = ganancia bruta − costos. Base estimada = máximo entre 0 y la ganancia antes de impuestos. Impuesto estimado = base × tasa / 100.',
          'Ganancia neta = ganancia bruta − costos − impuesto. Rendimiento neto = ganancia neta / capital × 100.',
          'Ejemplo: capital $100,000, ganancia bruta $12,000, comisiones $800 y otros costos $200. Costos $1,000, ganancia antes de impuestos $11,000, impuesto al 25% $2,750, ganancia neta $8,250 y rendimiento neto 8.25%.',
        ),
        section(
          'Consolidado',
          'El rendimiento neto consolidado = ganancia neta total / capital total × 100. No se promedian los rendimientos individuales.',
          'Sumar una ganancia mensual con otra trimestral o anual no produce un rendimiento comparable: por eso el sistema te advierte cuando mezclas periodos.',
        ),
      ],
      exercise: {
        prompt: '¿Cuál de tus actividades pierde más rendimiento por costos e impuestos y por qué?',
        steps: ['Registra al menos un negocio o inversión.', 'Revisa su resultado individual.', 'Compara el consolidado.', 'Registra tus conclusiones.'],
      },
    },
  },
  {
    month: 11,
    title: 'Inflación y poder adquisitivo',
    summary: 'Simula cómo la inflación cambia el valor real de tu dinero a lo largo del tiempo.',
    content: {
      tool: { name: 'Simulador de poder adquisitivo', question: '¿Cuánto valdrá realmente mi dinero dentro de unos años?' },
      essentials: [
        'Crea escenarios con capital, horizonte, inflación supuesta y rendimiento nominal supuesto.',
        'Puedes cargar el capital de una inversión o meta existente: la conexión es solo de lectura.',
        'Los escenarios son simulaciones educativas: no modifican Patrimonio, Mi cartera, Cortes, Ingresos ni Gastos.',
      ],
      riskNotes: ['Inflación y rendimiento son supuestos, no pronósticos. Esta versión no considera aportaciones adicionales, comisiones ni impuestos.'],
      lesson: [
        section(
          'Nominal frente a real',
          'El valor nominal es la cantidad de pesos. El valor real es lo que esos pesos pueden comprar. Con inflación positiva, el mismo monto compra menos con el tiempo.',
        ),
        section(
          'Fórmulas del escenario',
          'Valor futuro nominal = capital × (1 + rendimiento)^años. Valor futuro en pesos de hoy = valor nominal / (1 + inflación)^años.',
          'Costo futuro de una compra de hoy = capital × (1 + inflación)^años. Valor real del capital sin rendimiento = capital / (1 + inflación)^años.',
          'Rendimiento real anual supuesto = (1 + rendimiento) / (1 + inflación) − 1.',
        ),
        section(
          'Lectura del resultado',
          'Si el rendimiento supuesto es menor que la inflación supuesta, el escenario muestra pérdida de poder adquisitivo aunque el saldo nominal crezca.',
        ),
      ],
      exercise: {
        prompt: 'Compara un escenario sin rendimiento contra otro con rendimiento: ¿qué diferencia observas en el valor real?',
        steps: ['Crea al menos un escenario.', 'Prueba distintos supuestos de inflación y rendimiento.', 'Compara valor nominal y valor real.', 'Registra tus conclusiones.'],
      },
    },
  },
  {
    month: 12,
    title: 'Plan patrimonial anual',
    summary: 'Revisa automáticamente la evolución de tu patrimonio en los últimos 12 meses completos.',
    content: {
      tool: { name: 'Mi evolución patrimonial', question: '¿Cómo cambió mi patrimonio durante el último año y qué tan cerca estoy de mi meta?' },
      essentials: [
        'El periodo son los últimos 12 meses calendario completos; el mes en curso no se incluye.',
        'Los valores provienen de tus cortes mensuales y registros: no vuelves a capturar activos ni deudas.',
        'Si falta información histórica, el informe lo indica y no inventa cifras.',
      ],
      riskNotes: ['Un aumento de activos puede deberse a aportaciones, compras, revalorizaciones o rendimientos: no todo aumento es rentabilidad.', 'Lectura educativa: no constituye asesoría ni recomendación de inversión.'],
      lesson: [
        section(
          'Ingresos no es patrimonio',
          'Tener ingresos no significa necesariamente acumular patrimonio. El patrimonio neto es lo que queda después de restar tus deudas a tus activos.',
        ),
        section(
          'Fórmulas del informe',
          'Patrimonio inicial = activos iniciales − deudas iniciales. Patrimonio final = activos finales − deudas finales. Variación patrimonial = final − inicial; variación porcentual = variación / patrimonio inicial × 100.',
          'Ejemplo: activos de $1,458,000 a $1,533,000 y deudas de $250,000 a $205,000. El patrimonio pasa de $1,208,000 a $1,328,000: una variación de $120,000 (9.93%).',
        ),
        section(
          'Reducir deudas también suma',
          'Una disminución de deuda puede mejorar tu patrimonio aunque tus activos no aumenten. El informe evita contar dos veces el mismo pago.',
        ),
        section(
          'Meta e historial',
          'La meta patrimonial se compara con tu patrimonio final para medir distancia y avance. Al guardar la revisión anual se conserva un snapshot que no cambia aunque después modifiques tus datos.',
        ),
      ],
      exercise: {
        prompt: '¿Qué categoría influyó más en tu resultado del año y qué objetivo te propones para el siguiente?',
        steps: ['Revisa el periodo y los avisos de información.', 'Analiza activos, deudas y distribución.', 'Registra o actualiza tu meta patrimonial.', 'Escribe tus notas y guarda tu revisión anual.'],
      },
    },
  },
];
