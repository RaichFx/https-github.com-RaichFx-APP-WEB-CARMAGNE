# Paquete 0 — Seguridad, autenticación e identidad

## Incluido en este cambio

- Las contraseñas nuevas se guardan con PBKDF2-SHA256 y no en texto legible.
- Al iniciar sesión correctamente, las cuentas antiguas con PIN en claro se migran a hash sin forzar un reinicio ni eliminar datos.
- El alta desde administración requiere una sesión de propietario o administrador y envía la contraseña solo al endpoint protegido.
- Restablecer la contraseña exige sesión de administrador. La pantalla pública informa al trabajador de que debe contactar al administrador; no usa DNI, correo o teléfono como prueba suficiente.
- Las acciones sensibles de API usan token de Firebase, control de rol, límites de frecuencia y auditoría de servidor.
- El directorio de compañeros no devuelve DNI, teléfono, correo, QR, certificados ni credenciales.
- Los endpoints de Telegram y Gemini validan sesión, rol, tamaño y formato antes de procesar datos.
- No se persisten en localStorage las cachés sensibles ni los tokens de notificaciones.
- Las reglas de Firestore y Storage quedan preparadas en el repositorio con mínimos privilegios.

## Sin costes nuevos

Este cambio no activa facturación, planes, tarjetas, servicios externos, bases de datos nuevas ni despliegues de reglas. Reutiliza Firebase y Vercel ya existentes.

## Antes de desplegar reglas de Firebase

1. Guardar una copia de las reglas actuales en Firebase Console.
2. Revisar que los usuarios administrador existentes reciban el claim o rol correcto al iniciar sesión de nuevo.
3. Probar, con una cuenta de operario y otra de administrador, acceso a fichajes, certificados, nóminas y chat.
4. Desplegar Firestore Rules y Storage Rules únicamente tras esa comprobación manual.

## Recuperación autoservicio

La recuperación autoservicio segura requiere migrar formalmente la identidad de los trabajadores a Firebase Authentication con un correo verificado o un flujo de teléfono verificado. Esa migración no se ejecuta en este paquete porque afecta cuentas en producción y debe aprobarse y realizarse con una copia de seguridad y un plan de comunicación.

## Revisión recomendada

- Rotar cualquier token de bot o clave que se haya compartido por chat o haya estado expuesta.
- Mantener las variables de entorno solo en Vercel/Firebase; nunca en el repositorio.
- Revisar los registros security_audit del runtime ante fallos de acceso.
