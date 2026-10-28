# Corrección de altas de trabajadores

Cambios preparados en rama: no se han migrado cuentas, modificado reglas ni creado recursos o servicios.
La solicitud pública siempre queda pendiente, inactiva y con rol Operario. El inicio de sesión conserva sus errores genéricos.

## Pruebas sin datos reales
Con Node.js 24 (o una versión compatible con node:module.stripTypeScriptTypes):
`node tests/check-worker-registration.mjs`

El test carga el código del endpoint y del helper de commit, simula Firebase/Telegram y comprueba:
- validación de DNI/NIE y contraseñas;
- rechazo de duplicados de teléfono, correo y DNI;
- ningún permiso o activación controlable por el solicitante;
- respuestas 405/403/429/409/500 y Telegram no bloqueante;
- commit atómico concurrente sin alta parcial.

No realiza peticiones de red ni necesita claves.

## Alcance y limitaciones antes de publicar
- Pendiente comprobar build/preview y el flujo visual móvil. La prueba completa de alta y aprobación requiere un entorno aislado de producción o autorización específica para una cuenta de prueba. Una preview puede compartir la base de producción: no registrar allí sin comprobar su configuración.
- Cada alta nueva escribe un trabajador y tres reservas de identidad en el Firestore existente, en un único commit. Esto usa las cuotas existentes (no es almacenamiento ilimitado). No se activa facturación ni un servicio nuevo. No se han enviado escrituras de prueba a Firebase.
- worker_registration_keys es una colección privada por las reglas default-deny existentes; el servidor escribe con sus credenciales actuales. No hay que abrir las reglas.
- Las reservas son conservadoras: no se liberan automáticamente al borrar o editar un trabajador. Si hace falta reutilizar una identidad antigua, debe revisarla el administrador antes de liberar su reserva; no borrar claves a ciegas. La sincronización completa de reservas con edición/borrado está fuera de este cambio.
- Las cuentas históricas se comprueban con las consultas existentes, sin migrarlas. Las reservas impiden carreras entre nuevas altas de este endpoint; no cubren escrituras administrativas directas que se salten este endpoint.
- La comparación de correo/DNI histórico depende del formato guardado: no se hace una limpieza masiva ni se garantiza coincidencia para históricos con formatos diferentes.
- El limitador sigue siendo el existente en memoria, por instancia; se corrige su invocación y .allowed, sin añadir Redis. No es un límite global distribuido.
- El DNI/NIE de autorregistro exige letra correcta. No verifica titularidad legal ni control del teléfono. La aprobación manual sigue siendo necesaria.
- El correo recogido en el formulario no implica que ya esté verificado. La vinculación/verificación de recuperación existente sigue aplicándose tras la aprobación y acceso.
