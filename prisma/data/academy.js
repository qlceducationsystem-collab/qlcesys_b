// Contenido de la Academia financiera (12 meses). Fuente: documentos maestros QLC.
// Cada módulo: Educación → Herramienta → Ejercicio → Registro → Seguimiento.
// Contenido educativo: no contiene promesas de rendimiento ni recomendaciones personalizadas.

const tool = (code, name, path, description) => ({ code, name, path, description });

export const MODULES = [
  {
    month: 1,
    block: 1,
    title: 'Fundamentos',
    summary: 'Ahorrar, invertir, patrimonio, inflación, interés, interés compuesto, liquidez y riesgo.',
    content: {
      sections: [
        {
          title: 'Ahorrar e invertir no son lo mismo',
          body: [
            'Ahorrar es separar una parte de tus ingresos para no consumirla. Invertir es colocar ese capital en un activo, instrumento, proyecto o estrategia esperando obtener un beneficio futuro.',
            'El beneficio puede provenir de intereses, dividendos, crecimiento del precio, renta, flujo de efectivo o el resultado de una actividad empresarial. Ningún beneficio está garantizado: siempre existe riesgo.',
          ],
        },
        {
          title: 'Patrimonio',
          body: [
            'Tu patrimonio neto es lo que tienes menos lo que debes: activos − pasivos. Ganar dinero no es lo mismo que construir patrimonio; una persona puede tener ingresos altos y no acumular activos si gasta prácticamente todo lo que genera.',
          ],
        },
        {
          title: 'Inflación, interés e interés compuesto',
          body: [
            'La inflación reduce el poder adquisitivo del dinero con el tiempo. El interés es el costo o la remuneración del dinero en el tiempo.',
            'El interés compuesto ocurre cuando los rendimientos se reinvierten y comienzan a generar sus propios rendimientos. Funciona a favor cuando inviertes y en contra cuando mantienes deudas.',
          ],
        },
        {
          title: 'Liquidez y riesgo',
          body: [
            'Liquidez es la facilidad para convertir un activo en dinero sin perder valor. Riesgo es la posibilidad de que el resultado sea diferente al esperado, incluida la pérdida parcial o total del capital.',
          ],
        },
      ],
      keyIdeas: [
        'Invertir no debe reemplazar inmediatamente tu fuente de ingresos.',
        'Primero se protege, después se construye liquidez y luego se invierte.',
        'No existe una inversión perfecta: existe una estructura donde cada activo cumple una función.',
      ],
      tool: tool('patrimonio', 'Mi patrimonio inicial', '/app/patrimonio', 'Registra tu primer periodo y obtén la fotografía de activos, pasivos y patrimonio neto.'),
      exercise: {
        prompt: 'Haz una lista de todo lo que tienes y todo lo que debes. ¿Cuál es tu patrimonio neto aproximado hoy?',
        steps: ['Crea tu primer periodo mensual.', 'Registra tus inversiones en Mi cartera.', 'Registra tus deudas.', 'Revisa tu patrimonio neto.'],
      },
      tracking: 'Cada mes compara tu patrimonio neto con el del periodo anterior.',
    },
  },
  {
    month: 2,
    block: 1,
    title: 'Productos financieros',
    summary: 'Renta fija, renta variable, fondos, acciones, bienes raíces, negocios y activos digitales.',
    content: {
      sections: [
        {
          title: 'Renta fija',
          body: ['Puede aportar estabilidad relativa y determinados flujos, con riesgos propios como tasas, inflación, crédito del emisor y liquidez.'],
        },
        {
          title: 'Renta variable, fondos y acciones',
          body: ['Acciones, fondos y otros instrumentos cuyo valor puede fluctuar. Pueden utilizarse para buscar crecimiento patrimonial, con volatilidad y posibilidad de pérdida de capital.'],
        },
        {
          title: 'Bienes raíces y negocios',
          body: [
            'Los bienes raíces pueden combinar apreciación y generación de renta, pero tienen riesgos de liquidez, mantenimiento y mercado.',
            'Los negocios son actividades productivas que pueden generar flujo de efectivo, con riesgos operativos: demanda, competencia, personal, gastos e inventario.',
          ],
        },
        {
          title: 'Activos digitales',
          body: ['Clase de activos con características y riesgos específicos, incluida una elevada volatilidad y riesgos propios del ecosistema.'],
        },
      ],
      keyIdeas: ['Cada producto cumple una función distinta.', 'Antes de invertir pregunta: ¿qué estoy comprando y qué puede hacerme perder dinero?'],
      tool: tool('cartera', 'Mi cartera', '/app/cartera', 'Registra cada producto dentro de su categoría con capital inicial y final.'),
      exercise: {
        prompt: 'Clasifica cada una de tus inversiones en su categoría y describe qué función cumple dentro de tu patrimonio.',
        steps: ['Agrega cada producto en Mi cartera.', 'Captura capital inicial y final.', 'Observa el resultado y ROI de cada producto.'],
      },
      tracking: 'Actualiza el capital final de cada producto al cierre de cada mes.',
    },
  },
  {
    month: 3,
    block: 1,
    title: 'Construcción de cartera',
    summary: 'Diversificación, asignación de activos, horizonte temporal, tolerancia al riesgo, liquidez, volatilidad y correlación.',
    content: {
      sections: [
        {
          title: 'Diversificar no significa comprar muchas cosas',
          body: [
            'Diversificar significa distribuir el patrimonio entre fuentes y riesgos que no dependan exactamente del mismo factor. Diez activos que se comportan igual no crean necesariamente una buena diversificación.',
          ],
        },
        {
          title: 'Asignación de activos y horizonte',
          body: [
            'No existe un porcentaje universal que sea la cartera correcta para todos. La asignación se construye alrededor del objetivo, el horizonte, la capacidad para asumir pérdidas y la necesidad de liquidez.',
          ],
        },
        {
          title: 'Volatilidad y correlación',
          body: [
            'La volatilidad describe cuánto puede cambiar un precio. La correlación describe qué tanto se mueven juntos dos activos. Lo importante es qué tan relacionados están los riesgos.',
          ],
        },
      ],
      keyIdeas: ['La pregunta no es solo cuánto puedes ganar, sino qué ocurre si una parte de tu cartera cae.'],
      tool: tool('allocation', 'Allocation / distribución', '/app/allocation', 'Observa cómo está distribuido tu patrimonio por categoría y producto.'),
      exercise: {
        prompt: '¿Qué porcentaje de tu cartera depende de una sola categoría? ¿Qué pasaría si esa categoría cayera?',
        steps: ['Revisa tu distribución en Allocation.', 'Identifica la categoría con mayor participación.', 'Escribe tu reflexión en el registro del módulo.'],
      },
      tracking: 'Compara tu distribución mes a mes para ver si la estructura cambia.',
    },
  },
  {
    month: 4,
    block: 1,
    title: 'Inversiones de mayor riesgo',
    summary: 'Trading, apalancamiento, volatilidad, drawdown, riesgo de pérdida, ejecución, tecnología y automatización.',
    content: {
      sections: [
        {
          title: 'Apalancamiento',
          body: ['Permite controlar una exposición mayor utilizando menos margen, pero también puede amplificar las consecuencias de un movimiento adverso.'],
        },
        {
          title: 'Drawdown y riesgo de pérdida',
          body: [
            'El drawdown es la caída desde un máximo hasta un mínimo. Dos estrategias pueden mostrar el mismo rendimiento final con perfiles de riesgo completamente distintos.',
            'El desempeño histórico no elimina el riesgo de mercado; ningún resultado pasado garantiza resultados futuros.',
          ],
        },
        {
          title: 'Presupuesto de riesgo',
          body: ['Establece de antemano cuánto capital puede estar expuesto a estrategias de alta volatilidad. No improvises este número después de entrar al mercado.'],
        },
      ],
      keyIdeas: ['Una inversión de alto riesgo nunca debería tener, por sí sola, el poder de comprometer toda la estructura patrimonial.'],
      riskNote: 'El contenido es educativo. Las inversiones de alto riesgo pueden generar pérdidas significativas.',
      tool: tool('allocation', 'Exposición a alto riesgo', '/app/allocation', 'Consulta qué porcentaje de tu cartera está en activos de alto riesgo.'),
      exercise: {
        prompt: 'Define por escrito qué porcentaje máximo de tu patrimonio estarías dispuesto a exponer a alto riesgo y por qué.',
        steps: ['Revisa tu exposición actual en Allocation.', 'Registra tu presupuesto de riesgo en este módulo.'],
      },
      tracking: 'Revisa cada mes si tu exposición real coincide con tu presupuesto de riesgo.',
    },
  },
  {
    month: 5,
    block: 1,
    title: 'Trading',
    summary: 'Diferencia entre invertir y hacer trading y por qué el trading debe considerarse una actividad de alto riesgo.',
    content: {
      sections: [
        {
          title: 'Invertir frente a hacer trading',
          body: [
            'El trading busca aprovechar movimientos de precio mediante operaciones de compra, venta o ambas. Es diferente de una inversión tradicional de largo plazo y puede involucrar análisis, datos, ejecución, gestión de posiciones, automatización y apalancamiento.',
          ],
        },
        {
          title: 'La imagen distorsionada de las redes sociales',
          body: [
            'Mostrar solo operaciones ganadoras no permite conocer la distribución completa de resultados, el capital expuesto, los periodos negativos ni el riesgo utilizado.',
            'El trading profesional se analiza como un sistema: metodología + datos + infraestructura + ejecución + control de exposición + disciplina + evaluación.',
          ],
        },
      ],
      keyIdeas: ['El trading no es una forma sencilla de enriquecimiento.', 'El proceso y la infraestructura importan.'],
      riskNote: 'El trading es una actividad de alto riesgo y las pérdidas pueden ser significativas.',
      tool: tool('cartera', 'Activos de alto riesgo', '/app/cartera', 'Registra por separado tus posiciones de trading para medir su resultado real.'),
      exercise: {
        prompt: 'Si operas o planeas operar, registra la posición en la categoría Activos de alto riesgo y anota tus reglas de exposición.',
        steps: ['Registra la posición en Mi cartera.', 'Escribe tus reglas de tamaño de posición y pérdida máxima.'],
      },
      tracking: 'Mide el resultado real de tus posiciones de alto riesgo en cada corte mensual.',
    },
  },
  {
    month: 6,
    block: 1,
    title: 'Operación profesional',
    summary: 'Datos, infraestructura, gestión de riesgo, ejecución, automatización, algoritmos y monitoreo.',
    content: {
      sections: [
        {
          title: 'Infraestructura, ejecución y algoritmos',
          body: [
            'Una operación profesional se apoya en datos, infraestructura, ejecución, automatización, algoritmos y monitoreo. En mercados rápidos, la diferencia entre el precio esperado y el ejecutado puede cambiar el resultado.',
          ],
        },
        {
          title: 'Una estrategia especializada como asignación',
          body: [
            'Una estrategia especializada de trading puede ocupar una asignación dentro de una cartera, no necesariamente la totalidad del patrimonio.',
            'QLC se describe conceptualmente como una propuesta de trading no custodial / copytrading institucional para inversores individuales, donde la tecnología, el software, la ejecución, los algoritmos y la experiencia aportan la infraestructura. Es una descripción del modelo propuesto, no una garantía de resultados.',
            'El documento conceptual de QLC contempla una asignación inicial de 20 a 400 USDT por cuenta principal como medida de control de exposición, no como garantía. Cualquier condición comercial debe consultarse en los términos vigentes de QLC.',
          ],
        },
      ],
      keyIdeas: ['La gestión profesional también consiste en saber cuándo no aumentar la exposición.'],
      riskNote: 'Existe riesgo de mercado y, según la operativa, riesgo asociado al apalancamiento. Un límite de capital no convierte una estrategia en segura.',
      tool: tool('cortes', 'Cortes mensuales', '/app/cortes', 'Cierra tu periodo y conserva el historial de tu evolución patrimonial.'),
      exercise: {
        prompt: 'Realiza tu primer corte mensual conciliado y descarga el PDF.',
        steps: ['Verifica que tu periodo esté conciliado.', 'Cierra el periodo en Cortes mensuales.', 'Descarga el PDF del corte.'],
      },
      tracking: 'Cada mes cierra el periodo para construir tu historial patrimonial.',
    },
  },
  {
    month: 7,
    block: 2,
    title: 'Presupuesto y control financiero',
    summary: 'Aprende a administrar el dinero: dónde termina tu dinero y cuánto puedes destinar a ahorro e inversión.',
    content: {
      sections: [
        {
          title: 'Capacidad de ahorro',
          body: [
            'Capacidad de ahorro = ingresos − gastos. Es uno de los motores que permite transformar ingresos actuales en patrimonio futuro.',
            'Los porcentajes de tu presupuesto se calculan a partir de los importes reales que registras, no de porcentajes predefinidos.',
          ],
        },
      ],
      keyIdeas: ['Lo que no se mide no se puede administrar.'],
      tool: tool('flujo', 'Mi presupuesto mensual', '/app/ingresos-gastos', 'Registra ingresos y gastos y obtén tu distribución y capacidad de ahorro.'),
      exercise: {
        prompt: 'Registra todos tus ingresos y gastos del mes. ¿Qué categoría de gasto te sorprendió más?',
        steps: ['Registra cada ingreso.', 'Registra cada gasto por categoría.', 'Revisa tu capacidad de ahorro.'],
      },
      tracking: 'Compara tu capacidad de ahorro mes a mes.',
    },
  },
  {
    month: 8,
    block: 2,
    title: 'Fondo de emergencia y liquidez',
    summary: 'Proteger la estabilidad financiera antes de asumir riesgos.',
    content: {
      sections: [
        {
          title: 'Protección antes que inversión',
          body: [
            'Antes de buscar rendimiento revisa qué tan protegido está tu patrimonio: seguro de gastos médicos mayores, seguro de vida cuando existen dependientes económicos, fondo de emergencia y una estructura razonable para enfrentar obligaciones.',
            'La liquidez evita que una necesidad inmediata te obligue a vender una inversión en un momento desfavorable.',
          ],
        },
      ],
      keyIdeas: ['Evita que un solo acontecimiento destruya años de trabajo y ahorro.'],
      tool: tool('proteccion', 'Herramienta de liquidez y protección', '/app/proteccion', 'Registra liquidez, fondo de emergencia, reservas y coberturas.'),
      exercise: {
        prompt: '¿Cuántos meses de gastos cubre tu liquidez actual? ¿Cuentas con coberturas para eventos graves?',
        steps: ['Registra tu liquidez y fondo de emergencia.', 'Registra tus coberturas de seguro.', 'Revisa los meses de gastos cubiertos.'],
      },
      tracking: 'Observa cómo evoluciona tu liquidez en cada periodo.',
    },
  },
  {
    month: 9,
    block: 2,
    title: 'Deudas y costo del dinero',
    summary: 'Controlar obligaciones y entender su costo financiero.',
    content: {
      sections: [
        {
          title: 'La deuda reduce el patrimonio neto',
          body: [
            'Una deuda es un pasivo: reduce tu patrimonio neto y tiene un costo financiero. El costo aproximado mensual puede estimarse como saldo × tasa anual / 12.',
          ],
        },
      ],
      keyIdeas: ['El interés compuesto también trabaja en contra cuando mantienes deudas.'],
      tool: tool('deudas', 'Registro de deudas', '/app/deudas', 'Registra saldo, pago y tasa de cada obligación.'),
      exercise: {
        prompt: 'Ordena tus deudas por tasa de interés. ¿Cuál tiene el mayor costo mensual?',
        steps: ['Registra cada deuda con saldo, pago y tasa.', 'Revisa el costo mensual estimado.'],
      },
      tracking: 'Revisa cada mes la evolución del saldo de tus deudas.',
    },
  },
  {
    month: 10,
    block: 2,
    title: 'Impuestos y costo real de las inversiones',
    summary: 'Entender el rendimiento neto después de comisiones, costos e impuestos.',
    content: {
      sections: [
        {
          title: 'Rendimiento bruto frente a rendimiento neto',
          body: [
            'Ganancia bruta = capital inicial × rendimiento. Ganancia después de comisiones = ganancia bruta − comisiones − otros costos.',
            'Impuesto = ganancia después de comisiones × % de impuesto. El impuesto se aplica sobre la ganancia después de costos, no sobre el capital inicial.',
            'Resultado después de impuestos = ganancia después de comisiones − impuesto.',
          ],
        },
      ],
      keyIdeas: ['Si no hay comisiones u otros costos, registra $0. Si no defines impuesto, el porcentaje es 0%.'],
      riskNote: 'Las obligaciones fiscales concretas dependen de la jurisdicción y situación individual y pueden requerir asesoría profesional.',
      tool: tool('rendimiento-neto', 'Calculadora de rendimiento neto', '/app/academia/herramientas/rendimiento-neto', 'Separa rendimiento bruto, comisiones, costos, impuesto y resultado final.'),
      exercise: {
        prompt: 'Calcula el rendimiento neto de una de tus inversiones con sus comisiones reales.',
        steps: ['Abre la calculadora.', 'Captura capital, rendimiento, comisiones, costos e impuesto.', 'Guarda el resultado.'],
      },
      tracking: 'Compara el rendimiento neto de tus inversiones contra su rendimiento bruto.',
    },
  },
  {
    month: 11,
    block: 2,
    title: 'Inflación, poder adquisitivo y crecimiento real',
    summary: 'Comprender la diferencia entre crecimiento nominal y crecimiento real.',
    content: {
      sections: [
        {
          title: 'Crecimiento nominal y real',
          body: [
            'Un patrimonio puede aumentar en pesos y, aun así, perder poder adquisitivo si su crecimiento queda por debajo de la inflación.',
            'Valor real aproximado = valor nominal / (1 + inflación)^años.',
          ],
        },
      ],
      keyIdeas: ['Lo importante no es solo cuánto dinero tienes, sino qué puedes comprar con él.'],
      tool: tool('poder-adquisitivo', 'Simulador de poder adquisitivo', '/app/academia/herramientas/poder-adquisitivo', 'Introduce una cantidad, un horizonte y un escenario de inflación.'),
      exercise: {
        prompt: 'Simula tu patrimonio actual con un escenario de inflación y compáralo con el crecimiento de tus inversiones.',
        steps: ['Abre el simulador.', 'Captura cantidad, años, inflación y rendimiento nominal.', 'Guarda el escenario.'],
      },
      tracking: 'Compara cada año tu crecimiento patrimonial con la inflación del periodo.',
    },
  },
  {
    month: 12,
    block: 2,
    title: 'Plan patrimonial y revisión anual',
    summary: 'Medir y evaluar todo el año con tu Informe Patrimonial Anual.',
    content: {
      sections: [
        {
          title: 'Tu primer informe patrimonial anual',
          body: [
            'Con los cortes mensuales del año el sistema consolida patrimonio inicial y final, variación, crecimiento, ingresos, gastos, ahorro, deudas, liquidez y resultados por categoría.',
            'La sección "¿Qué cambió durante el año?" se genera a partir de tus propios datos registrados.',
          ],
        },
      ],
      keyIdeas: ['No solamente aprender sobre dinero: aprender a organizar, medir y comprender tu propio patrimonio.'],
      tool: tool('informe-anual', 'Informe patrimonial anual', '/app/informe-anual', 'Genera y descarga el informe consolidado del año.'),
      exercise: {
        prompt: 'Genera tu informe anual y escribe tres conclusiones sobre cómo cambió tu patrimonio y por qué.',
        steps: ['Genera el informe anual.', 'Lee la sección ¿Qué cambió durante el año?', 'Registra tus conclusiones.'],
      },
      tracking: 'El historial anual queda disponible para comparar Año 1, Año 2, Año 3...',
    },
  },
];
