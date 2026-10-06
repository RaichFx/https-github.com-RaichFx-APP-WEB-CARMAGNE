# Recuperación por correo: despliegue progresivo

## Alcance
Usa Firebase Authentication existente, sin SMS, nuevas funciones serverless ni nuevas dependencias. No modifica planes. La cuenta laboral conserva su UID, teléfono, fichajes y documentos. El correo del perfil NO se considera una identidad verificada.

## Activación
La vinculación está desactivada por defecto. Configurar FIREBASE_EMAIL_RECOVERY_WORKER_IDS con una lista de UIDs laborales autorizados, separada por comas. Empezar solo por la cuenta piloto autorizada por su titular. No escribir correos ni contraseñas personales en este repositorio.

Antes de vincular en una vista previa, desplegar el backend compatible en producción. La versión antigua de worker-login no sabe reconocer las contraseñas Firebase y podría seguir aceptando la credencial antigua.

La cuenta de servicio existente necesita poder leer usuarios Firebase con accounts:lookup. Si falta ese permiso, detenerse: no ampliar IAM automáticamente. Verificar las reglas desplegadas: el trabajador no puede modificar firebaseEmailRecovery ni firebaseEmailMigrated. Son campos escritos únicamente por el backend.

## Flujo
1. El trabajador inicia sesión con su acceso actual.
2. En Mi perfil introduce su correo, contraseña actual y una nueva contraseña de 8–128 caracteres, confirmada.
3. El backend verifica sesión, rol, cuenta activa, contraseña actual y autorización del piloto antes de marcar la migración pendiente.
4. Firebase linkWithCredential vincula email/password a la MISMA cuenta autenticada. No se crea un usuario nuevo.
5. El trabajador abre personalmente el correo de verificación. No entregar códigos ni enlaces al agente.
6. El siguiente login usa teléfono para localizar el trabajador, pero verifica la contraseña en Firebase y comprueba que el UID coincide. Tras un login correcto se retiran pin/pinHash antiguos con una escritura parcial, conservando todos los demás datos.
7. He olvidado mi contraseña envía un enlace Firebase. Nunca se restablece por conocer DNI, teléfono o correo.
8. Cambiar contraseña desde el perfil verifica la contraseña actual Firebase. El reset administrativo antiguo se bloquea para cuentas con email/password y remite al enlace de correo.

## Seguridad y límites
El rate limiting interno es solo por instancia serverless y no equivale a uno distribuido. Se reutiliza sin contratar Redis. Firebase aplica sus propios controles y cuotas. La respuesta de recuperación no confirma si existe una cuenta. Activar protección contra enumeración solo tras revisar su configuración actual y compatibilidad; este cambio no la activa automáticamente.

No eliminar proveedores email/password ni volver a un backend antiguo después de migrar una cuenta. El marcador firebaseEmailMigrated impide volver a las credenciales heredadas. No borrar cuentas para resolver correos duplicados.

## Comprobaciones antes de declarar terminado
- [ ] Build del despliegue final correcto.
- [ ] Login de trabajador no habilitado conserva funcionamiento.
- [ ] Piloto puede consultar su historial antes/después con el mismo UID.
- [ ] Vinculación rechaza contraseña actual incorrecta, sesión ajena y UID fuera de la lista.
- [ ] Correo duplicado no crea otra identidad y mantiene el acceso previo.
- [ ] Titular verifica correo y completa reset personalmente.
- [ ] Nueva contraseña funciona; antigua deja de funcionar.
- [ ] Cambio de contraseña del perfil funciona tras reset.
- [ ] Cuenta inactiva no puede entrar ni preparar vinculación.
- [ ] Fallo de correo no se presenta como pérdida de la vinculación ya realizada.
- [ ] Reglas reales protegen los dos marcadores.

Este documento es una lista de pruebas pendientes, no evidencia de haberlas ejecutado. No realizar fichajes, borrar datos ni enviar correos masivos como prueba.
