# Verificación automática al registrarse

Las nuevas autoaltas guardan una solicitud pendiente y solicitan automáticamente el correo de verificación mediante Firebase Auth existente. No es un correo de bienvenida adicional.
El usuario puede reenviar y retomar desde el acceso con su teléfono/contraseña. Verificar no aprueba; para entrar se exige verificación y aprobación independiente.
La instancia secundaria de Auth solo usa memoria y no reemplaza la sesión principal. Su token solo contiene registrationPending, sin rol laboral.
Las cuentas existentes conservan su flujo. La creación desde administración conserva su ruta segura actual; no envía correos automáticamente en nombre del trabajador.

## Protección y publicación
Se consultaron las reglas efectivamente publicadas el 29/10/2026. Son anteriores a las de GitHub y solo reconocen roles administrativos en minúsculas.
Se publicó UNICAMENTE la restricción de lectura de sites a roles laborales; los demás permisos publicados no se modificaron. La sesión de verificación no tiene ese rol.
Storage ya exige rol para certificados/nóminas y deniega el resto. No se amplió ningún permiso.
Las reglas completas de este repositorio NO se han desplegado: sigue pendiente conciliar la diferencia de roles administrativos en un cambio separado.

## Pruebas
Pruebas aisladas ejecutadas con código real y dobles de Firebase: alta, duplicados, permisos administrativos, validación, emisión de token limitado, sesión secundaria, envío/reenvío, fallos de enlace/cuota, verificación y aprobación separadas, cuentas antiguas.
Cero correos reales y cero altas de prueba. Pendiente confirmar recepción/enlace y pantalla con un registro real autorizado.
No se puede garantizar entrega a bandeja: depende del proveedor, spam y cuotas.

## Costes
No se activaron servicios, planes, SMS ni SMTP. Se reutilizan las cuotas existentes.
La consola indica un plan Blaze ya existente; no se modificó. No se afirma que toda la infraestructura tenga coste cero.
El reenvío espera 60 segundos y se conservan límites de registro/login y del proveedor.
