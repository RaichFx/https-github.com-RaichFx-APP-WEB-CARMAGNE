# Verificación del correo al registrarse

## Alcance
Rama independiente de las correcciones de auditoría 1–7 (esas correcciones siguen pendientes).
No se han cambiado usuarios, credenciales, planes, permisos IAM ni reglas desplegadas.
No se han creado proyectos Firebase nuevos: la instancia secundaria es únicamente una sesión del SDK en el navegador.

- Solo las nuevas autoaltas reciben emailVerificationRequired y firebaseEmailRecovery.
- El formulario guarda la solicitud inactiva/pending y solicita inmediatamente la vinculación y el correo de verificación mediante Firebase Authentication.
- El token emitido para esta fase lleva exclusivamente registrationPending: true. No contiene role ni workerId.
- La sesión de verificación usa otra instancia de Auth y persistencia solo en memoria. No sustituye la sesión principal.
- El envío se solicita con sendEmailVerification, en español. No es un correo de bienvenida adicional ni una garantía de entrega en bandeja.
- Verificar el correo NO aprueba al trabajador. El login normal exige contraseña válida, correo realmente verificado por Firebase y aprobación.
- Si se interrumpe el envío, entrar con teléfono/contraseña permite retomar la verificación sin otro registro.
- Los errores y límites de Firebase se muestran sin presentar una solicitud guardada como un registro fallido.
- Las cuentas anteriores no se migran ni se obliga a volver a verificar por esta modificación.
- No se envían correos al crear cuentas desde la vía administrativa antigua. La unificación de esa vía pertenece a la auditoría pendiente.

## Condición de seguridad antes de cualquier alta real
El archivo firestore.rules de esta rama cambia la lectura de sites: exige un rol de la app en lugar de cualquier sesión autenticada.
Una sesión de verificación está autenticada en Firebase pero no tiene rol laboral.
Esta regla debe contrastarse con las reglas realmente desplegadas, probarse y desplegarse ANTES de activar la función o registrar cuentas reales en preview.
El resto de permisos no se amplía y esta rama no publica reglas automáticamente.
No ejecutar pruebas contra la base de producción desde una preview: pueden compartir el mismo proyecto Firebase.

## Costes y límites
Se reutiliza Firebase Authentication y el Firestore existentes. No hay SMS, extensiones, servidor de email, plan nuevo ni activación de billing.
Las operaciones consumen las cuotas actuales del proyecto; este cambio no demuestra que el plan actual sea Spark ni garantiza consumo ilimitado o cero facturación de una infraestructura ya facturable.
Firebase publica 1.000 correos de verificación/día en Spark; no se actualizará el plan si se alcanza una cuota.
El botón de reenvío tiene espera de un minuto, además de las protecciones del proveedor y el limitador actual del registro/login. No es un limitador distribuido nuevo.
Fuentes: https://firebase.google.com/docs/auth/limits y https://firebase.google.com/docs/auth/web/manage-users

## Verificación sin recursos reales (Node.js 24)
- node tests/check-worker-registration.mjs
- node tests/check-registration-email.mjs
- node tests/check-registration-email-client.mjs

Los tests ejecutan código real del endpoint, del helper cliente y de las acciones del formulario con dobles de Firebase, red y React.
Comprueban tokens mínimos, contraseña, aprobación separada, rechazo de cuentas desactivadas/rechazadas, compatibilidad de cuentas antiguas, sesión secundaria, envío automático y recuperación de errores.
No envían correos ni escrituras reales. La regla sites tiene una comprobación estática, NO una prueba del emulador.

## Pendiente antes de producción
1. Revisar y probar la regla de sites en un entorno aislado y confirmar su despliegue.
2. Confirmar que Email/Password sigue habilitado en el proyecto existente. No habilitar servicios de pago ni cambiar IAM por esta rama.
3. Probar la pantalla en navegador/móvil; comprobar configuración de dominio y plantilla de correo.
4. Con autorización y correo de prueba del titular, comprobar recepción del mensaje y enlace, bloqueo antes de verificar/aprobar y acceso posterior con el mismo UID.
5. Solo entonces publicar con autorización del usuario. No fusionar esta rama mientras esas comprobaciones estén pendientes.
