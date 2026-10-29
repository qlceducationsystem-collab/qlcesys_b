import { BLOCK_2 } from './academyBlock2.js';

const section = (title, ...paragraphs) => ({ title, paragraphs });

const BLOCK_1 = [
  {
    month: 1,
    title: 'Fundamentos',
    summary: 'Ahorro, inversión, patrimonio, inflación, interés, interés compuesto, liquidez y riesgo.',
    content: {
      tool: { name: 'Diagnóstico financiero inicial', question: '¿Cuál es mi situación financiera actual y cuál es mi punto de partida?' },
      essentials: [
        'Registra tu flujo mensual, tu patrimonio actual y tu liquidez.',
        'La información se guarda como tu línea base y alimenta Inicio, Ingresos y gastos, Patrimonio, Protección y Mi cartera.',
        'El diagnóstico no te dice dónde invertir: muestra la estructura actual de tus finanzas.',
      ],
      riskNotes: ['Los indicadores son educativos y no constituyen una calificación definitiva de tu situación.'],
      lesson: [
        section(
          'Una radiografía financiera inicial',
          'La herramienta del Módulo 1 no pretende decirte “invierte aquí” o “haz esto”. Su función es responder: ¿cuál es mi situación financiera actual y cuál es mi punto de partida?',
          'El Módulo 1 dice “así estás hoy”. Los módulos siguientes miden y mejoran cada parte, y el sistema principal podrá mostrar cómo estabas al comenzar y cómo estás ahora.',
        ),
        section(
          'Tasa de ahorro',
          'Es el dinero que queda después de gastos y pagos de deuda, dividido entre tus ingresos. Con ingresos de $30,000, gastos de $22,000 y deuda mensual de $3,000 quedan $5,000: una tasa de ahorro de 16.7%.',
          'Lectura educativa: 20% o más indica buena capacidad de ahorro; entre 10% y 19.9% una capacidad moderada; menos de 10% sugiere revisar la estructura de gastos.',
        ),
        section(
          'Patrimonio neto',
          'Responde: si hoy sumara todo lo que tengo y restara todo lo que debo, ¿cuánto realmente tengo? Activos de $400,000 con deudas de $80,000 representan un patrimonio neto de $320,000.',
        ),
        section(
          'Liquidez',
          'Responde: si mañana dejo de recibir ingresos, ¿cuánto tiempo puedo seguir pagando mis gastos? Un fondo de $50,000 con gastos de $22,000 cubre aproximadamente 2.3 meses.',
          'Una persona puede tener un patrimonio elevado y aun así muy poca liquidez. Patrimonio no es lo mismo que liquidez.',
        ),
        section(
          'Inversión / patrimonio y deuda / patrimonio',
          'Inversión / patrimonio muestra qué parte del patrimonio neto está colocada en inversiones e introduce el concepto de Allocation.',
          'Deuda / patrimonio muestra el peso de la deuda respecto al patrimonio neto. Es un indicador educativo: para analizar realmente una deuda se necesitan tasa, plazo, pago y tipo de deuda.',
        ),
        section(
          'Flujo disponible',
          'Es lo que queda después de pagar gastos, deuda y la aportación programada a inversión. Muestra la diferencia entre el dinero que queda antes de invertir y el que queda después de cumplir tu plan financiero.',
        ),
      ],
      exercise: {
        prompt: 'Completa tu diagnóstico con tus datos reales y escribe qué indicador te sorprendió más y por qué.',
        steps: ['Captura tu flujo mensual.', 'Captura tu patrimonio actual y tu fondo de emergencia.', 'Genera y guarda el diagnóstico.', 'Revisa cómo se reflejó en Inicio y Patrimonio.'],
      },
    },
  },
  {
    month: 2,
    title: 'Productos financieros',
    summary: 'Renta fija, renta variable, fondos, acciones, bienes raíces, negocios y activos digitales.',
    content: {
      tool: { name: 'Mapa de productos financieros', question: '¿Exactamente en qué productos tengo mi dinero y qué características tiene cada uno?' },
      essentials: [
        'Registra cada producto individualmente: nombre, tipo, capital actual, horizonte, liquidez y riesgo percibido.',
        'Cada producto alimenta Mi cartera, Allocation y Patrimonio. No necesitas registrarlo dos veces.',
        'La herramienta no recomienda qué comprar: ayuda a entender y ordenar.',
      ],
      riskNotes: [],
      lesson: [
        section(
          'De la cifra global a los productos individuales',
          'En el Módulo 1 registraste tus inversiones como una cifra global. Ahora el Módulo 2 empieza a descomponerla: qué parte está en CETES, en fondos, en acciones o en activos digitales.',
          'Módulo 1 es la fotografía financiera; Módulo 2 es la composición de los activos; Módulo 3 será la construcción de la cartera.',
        ),
        section(
          'Qué información se registra por producto',
          'Nombre y tipo del producto, capital actual, horizonte (corto, mediano o largo plazo), liquidez (alta, media o baja) y riesgo percibido (bajo, medio, alto o muy alto).',
          'El horizonte enseña que no todos los activos tienen la misma función temporal; la liquidez conecta con lo aprendido en el Módulo 1; el riesgo prepara los módulos de cartera y riesgo.',
        ),
        section(
          'Cómo se conecta con la plataforma',
          'Producto individual → categoría → Mi cartera → Allocation → Patrimonio. Si registras BTC, ETH y otros activos digitales, el sistema puede consolidarlos en su categoría.',
          'Así los módulos no son cursos independientes: cada uno utiliza la información construida en el anterior.',
        ),
      ],
      exercise: {
        prompt: 'Registra todos tus productos. ¿Hay alguna parte de tus inversiones que todavía no sabías clasificar?',
        steps: ['Agrega cada producto con su capital actual.', 'Clasifica horizonte, liquidez y riesgo.', 'Revisa el capital pendiente por desglosar.'],
      },
    },
  },
  {
    month: 3,
    title: 'Construcción de cartera',
    summary: 'Diversificación, asignación de activos, horizonte, tolerancia al riesgo, liquidez, volatilidad y correlación.',
    content: {
      tool: { name: 'Constructor de cartera', question: '¿Cómo está distribuido mi dinero entre las diferentes categorías de activos?' },
      essentials: [
        'La cartera actual se calcula con los productos que ya registraste: no vuelves a escribir capitales.',
        'La simulación educativa es independiente y no modifica tu cartera real.',
        '“Equilibrada” no significa cartera recomendada, segura ni correcta.',
      ],
      riskNotes: ['La lectura educativa usa parámetros definidos por QLC y no es una recomendación de inversión.'],
      lesson: [
        section(
          'De productos a cartera',
          'Los productos se agrupan por categoría y la herramienta calcula qué porcentaje representa cada una. Ahora puedes ver tu cartera, no solamente saber cuánto dinero tienes.',
          'Tener cuatro inversiones no significa necesariamente estar diversificado. Por ejemplo, cuatro activos digitales pueden concentrar la misma clase de riesgo. Número de productos no es igual a diversificación real.',
        ),
        section(
          'Allocation',
          'En este módulo aprendes a interpretar tu asignación. Después, la sección permanente Allocation conserva esa distribución y la actualiza conforme cambia la cartera.',
        ),
        section(
          'Lectura educativa',
          'Se calcula con cinco variables: diversificación por categorías (30%), concentración de la categoría principal (30%), exposición a alto riesgo (20%), liquidez (10%) y número de categorías utilizadas (10%).',
          'Resultado: 80–100 Equilibrada, 60–79 Moderada, 40–59 Concentrada, 0–39 Muy concentrada.',
          '“Equilibrada” significa únicamente que la estructura presenta una distribución relativamente diversificada y sin una concentración dominante según los parámetros educativos de QLC. No existe un porcentaje universal correcto para todas las personas.',
        ),
        section(
          'Rendimientos de tus productos',
          'Para que tu cartera refleje lo que generan tus inversiones, dirígete a la sección Mi cartera. Ahí puedes automatizar la rentabilidad mensual de cada producto (un monto fijo o un porcentaje, el día en que la recibes y su plazo) para que el sistema la sume sola cada mes.',
          'Si prefieres hacerlo tú, regístrala manualmente cada mes con el botón «Registrar rentabilidad del mes» de cada producto. También puedes corregirla o dejarla en cero si algún mes no la recibiste.',
        ),
      ],
      exercise: {
        prompt: '¿Qué categoría concentra más tu patrimonio? ¿Qué pasaría con tu cartera si esa categoría cayera?',
        steps: ['Revisa tu cartera actual.', 'Compara con una simulación educativa.', 'Registra tu reflexión y completa el módulo.'],
      },
    },
  },
  {
    month: 4,
    title: 'Inversiones de mayor riesgo',
    summary: 'Riesgo, volatilidad, apalancamiento, exposición, drawdown y efecto del movimiento sobre la exposición.',
    content: {
      tool: { name: 'Mapa de exposición y simulador de riesgo', question: '¿Qué estoy arriesgando?' },
      essentials: [
        'Simulación educativa: no modifica Mi cartera, Patrimonio, Allocation, Ingresos ni Gastos.',
        'Compara el mismo movimiento con 1x, 10x y 50x: el movimiento del mercado no cambia, cambia la exposición.',
      ],
      riskNotes: [
        'El apalancamiento aumenta tanto la sensibilidad a movimientos favorables como a movimientos adversos. Una operación apalancada puede generar pérdidas significativas sobre el margen utilizado.',
      ],
      lesson: [
        section(
          'Riesgo y exposición',
          'Con 1,000 USD de capital y 10x de apalancamiento, la exposición nominal es de 10,000 USD. Un movimiento de 2% a favor produce aproximadamente +200 USD; en contra, −200 USD.',
          'Sin apalancamiento el mismo 2% equivale a ±20 USD; con 50x a ±1,000 USD. El movimiento del mercado no cambió: lo que cambió fue la exposición.',
        ),
        section(
          'Volatilidad y drawdown',
          'La volatilidad describe cuánto puede cambiar el precio. El drawdown es una caída desde un máximo de referencia hasta un mínimo posterior. Dos estrategias pueden mostrar el mismo resultado con perfiles de riesgo completamente distintos.',
        ),
        section(
          'Simulación ≠ situación real',
          'Si simulas 1,000 USD con 50x, eso no significa que realmente tengas 50,000 USD expuestos. La plataforma guarda el ejercicio como resultado educativo, separado de tu patrimonio.',
        ),
      ],
      exercise: {
        prompt: 'Utiliza 1,000 USD de margen y compara qué ocurre con 1x, 10x y 50x ante un movimiento adverso de 2%.',
        steps: ['Simula el escenario con cada apalancamiento.', 'Guarda al menos una simulación.', 'Responde: ¿qué cambió realmente, el mercado o la exposición?'],
      },
    },
  },
  {
    month: 5,
    title: 'Trading',
    summary: 'Simulación de una operación: entrada, salida, LONG/SHORT, exposición, costos y resultado sobre el margen.',
    content: {
      tool: { name: 'Simulador de una operación', question: '¿Cómo funciona una operación?' },
      essentials: [
        'No ejecuta órdenes, no se conecta a ningún exchange y no modifica tu información patrimonial.',
        'El resultado es simulado y educativo, no una rentabilidad esperada.',
      ],
      riskNotes: [
        'Una simulación favorable no significa que una operación real sea segura, rentable o repetible.',
        'En un exchange real pueden intervenir comisiones de entrada y salida, spread, funding, tasa de mantenimiento, slippage, precio de liquidación y reglas específicas.',
      ],
      lesson: [
        section(
          'Fórmulas de la operación',
          'Exposición nominal = capital / margen × apalancamiento.',
          'LONG: movimiento % = (precio de salida − precio de entrada) / precio de entrada × 100. SHORT: movimiento % = (precio de entrada − precio de salida) / precio de entrada × 100.',
          'Resultado bruto = exposición nominal × movimiento decimal. Costos simulados = exposición nominal × porcentaje de costos. Resultado neto = resultado bruto − costos. Resultado sobre margen = resultado neto / capital × 100.',
        ),
        section(
          'Ejemplo completo',
          'Con 1,000 USD, LONG, 10x, entrada 100,000 USD y salida 102,000 USD: exposición 10,000 USD, movimiento +2%, resultado bruto +200 USD, costos simulados (0.10%) −10 USD, resultado neto +190 USD, es decir +19% sobre tus 1,000 USD.',
          'Si la salida fuera 98,000 USD en LONG, el resultado bruto sería −200 USD y el neto −210 USD (−21% sobre el margen).',
        ),
      ],
      exercise: {
        prompt: 'Con 1,000 USD, entrada 100,000 USD y salida 102,000 USD prueba 1x, 10x y 50x. ¿Qué cambió realmente: el movimiento del mercado o la exposición de la operación?',
        steps: ['Simula el escenario con 1x, 10x y 50x.', 'Simula también un escenario adverso.', 'Guarda tus simulaciones y responde la pregunta.'],
      },
    },
  },
  {
    month: 6,
    title: 'Operación profesional',
    summary: 'Datos, gestión del riesgo, exposición, ejecución, automatización, monitoreo, registro y control operativo.',
    content: {
      tool: { name: 'Laboratorio de gestión multiposición', question: '¿Cómo se comporta un conjunto de posiciones expuestas al mismo mercado?' },
      essentials: [
        'Simulación educativa: no conecta exchanges ni realiza trading real.',
        'Los resultados no alimentan tu patrimonio, cartera ni allocation.',
      ],
      riskNotes: [
        '“Profesional” no significa “seguro” ni “rentable”. Automatizar no elimina el riesgo de mercado ni garantiza resultados.',
      ],
      lesson: [
        section(
          'Laboratorio de gestión multiposición',
          'En esta práctica aprenderás cómo se comporta una cartera de varias posiciones cuando todas están expuestas a los movimientos de un mismo mercado. Cada operación puede tener dirección, margen, apalancamiento y reglas de salida diferentes; por eso, un mismo movimiento de BTC/USDT no produce el mismo resultado en todas las posiciones.',
          'El objetivo no es predecir el mercado ni prometer rentabilidad. Es comprender la exposición, el resultado agregado, las salidas por take profit o stop loss y el drawdown en un escenario simulado. Activo de referencia: BTC/USDT · precio inicial simulado: 100,000 USDT.',
        ),
        section(
          'Conceptos fundamentales del laboratorio',
          'Capital operativo total: límite de capital del escenario. La suma de los márgenes asignados no debe superarlo.',
          'Margen asignado: capital destinado como margen a una posición; no es lo mismo que la exposición nominal.',
          'Exposición nominal: se calcula como margen × apalancamiento y representa el tamaño nominal de la posición en el modelo.',
          'LONG y SHORT: LONG obtiene un resultado favorable si el precio sube; SHORT, si baja, antes de considerar costos.',
          'Take profit (TP): movimiento porcentual favorable desde la entrada que activa el cierre simulado.',
          'Stop loss (SL): movimiento porcentual adverso desde la entrada que activa el cierre simulado.',
          'Riesgo estimado: la herramienta calcula automáticamente la pérdida estimada al SL = exposición nominal × SL %. También muestra qué proporción representa respecto al margen asignado.',
          'Resultado neto: suma de resultados realizados y no realizados de las posiciones del escenario.',
          'Drawdown máximo: mayor caída porcentual desde el máximo de balance registrado por la simulación; no describe por sí solo todas las dimensiones del riesgo.',
        ),
        section(
          'Cómo utilizar el laboratorio',
          '1. Configura el escenario general: introduce capital operativo, número de posiciones, apalancamiento máximo y nivel de volatilidad.',
          '2. Revisa el mercado simulado: el precio inicial aparece como BTC/USDT 100,000. Cada ronda genera un movimiento aleatorio dentro del rango elegido; no es una cotización en tiempo real.',
          '3. Configura cada posición: revisa entrada, LONG/SHORT, margen, apalancamiento, TP y SL. El sistema calcula exposición, resultado y riesgo estimado en USD.',
          '4. Genera una ronda: pulsa “Generar movimiento del mercado” y observa el efecto en las posiciones abiertas. Las que alcanzan TP o SL se cierran según las reglas del modelo.',
          '5. Ejecuta diez rondas para observar una secuencia de movimientos, el balance combinado y cuántas posiciones siguen abiertas.',
          '6. Pulsa “Cerrar posiciones y evaluar” para cerrar las posiciones restantes al precio simulado actual y revisar el resultado final.',
          '7. Reinicia y compara escenarios modificando una variable a la vez, como margen, apalancamiento, TP, SL o volatilidad.',
        ),
        section(
          '¿Qué debes observar?',
          'Una subida puede favorecer a LONG y perjudicar a SHORT; una caída puede producir el efecto contrario.',
          'Posiciones con diferentes márgenes y apalancamientos tienen exposiciones distintas, aunque compartan el mismo precio de referencia.',
          'El resultado agregado puede ser positivo aunque algunas posiciones pierdan, o negativo aunque algunas ganen.',
          'Un apalancamiento mayor aumenta la exposición para un mismo margen y puede amplificar ganancias y pérdidas.',
          'El TP y el SL modifican cuándo se cierran las posiciones en el modelo.',
          'El drawdown importa porque el recorrido del balance puede ser distinto del resultado final.',
        ),
        section(
          'Preguntas para comprobar tu aprendizaje',
          'Si BTC/USDT sube, ¿qué efecto esperas en una posición LONG y en una SHORT?',
          '¿Cuál es la diferencia entre margen asignado y exposición nominal?',
          '¿Por qué el sistema calcula el riesgo estimado en lugar de pedirte que introduzcas manualmente ese resultado?',
          '¿Puede una cartera multiposición tener posiciones ganadoras y perdedoras al mismo tiempo? ¿Qué debes revisar para evaluar el conjunto?',
          '¿Por qué un resultado positivo en una simulación aleatoria no demuestra que exista una ventaja estadística?',
          '¿Qué variables cambiarías para comparar dos escenarios de forma ordenada?',
        ),
        section(
          'Conclusión del laboratorio',
          'La gestión multiposición no consiste solamente en contar cuántas operaciones ganan. Consiste en entender cómo se combinan dirección, tamaño, apalancamiento y reglas de salida para producir un resultado global. La simulación permite practicar estas relaciones; no sustituye un plan de riesgo real ni representa una predicción.',
          'Aviso educativo: los movimientos son aleatorios y no representan cotizaciones reales, pronósticos, una estrategia validada ni una garantía de rentabilidad. El modelo puede no incluir comisiones, deslizamiento, financiación, margen de mantenimiento ni reglas reales de liquidación.',
        ),
      ],
      exercise: {
        prompt: 'En el laboratorio abre varias posiciones sobre BTC/USDT y mueve el precio. ¿Por qué un mismo movimiento del mercado no produce el mismo resultado en todas las posiciones?',
        steps: ['Configura al menos tres posiciones con dirección, margen y apalancamiento distintos.', 'Mueve el precio y observa el resultado agregado y el drawdown.', 'Registra tu respuesta y completa la Ruta de Mercados.'],
      },
    },
  },
];

export const MODULES = [...BLOCK_1.map((m) => ({ ...m, block: 1 })), ...BLOCK_2.map((m) => ({ ...m, block: 2 }))];
