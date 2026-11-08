# Uni · WS 2026/27

App web instalable (PWA) para estudiar sin distracciones:

- **Estudio**: botón Empezar/Parar (como fichar en Personio). Cuenta las horas por asignatura, guarda qué estás haciendo y lanza los atajos de Apple para activar y desactivar la Concentración «Universidad». Muestra el objetivo semanal, la racha de días y los días que faltan para cada examen. Pomodoro opcional.
- **Tablero**: tableros, listas y tarjetas que se arrastran (fecha, etiqueta y descripción).
- **Tareas**: se importan del calendario iCal de ILIAS cada 3 horas, y además puedes crear y editar las tuyas.

## Despliegue en Railway

1. En Railway: New Project → Deploy from GitHub repo → `uni-app`.
2. En el mismo proyecto: + New → Database → **PostgreSQL**.
3. En el servicio `uni-app` → Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - (opcional) `API_TOKEN` = token para que Claude pueda leer y escribir por la API
4. Settings → Networking → **Generate Domain**.
5. **Abre la URL enseguida** y pulsa «Activar Face ID / Touch ID»: el primer passkey que se registra es el dueño, y a partir de ahí solo se entra con él. Puedes añadir más dispositivos en Ajustes. `APP_PASSWORD` es opcional y sirve como plan B.
6. Abre la URL en Safari → Compartir → **Añadir a pantalla de inicio**. En el Mac: Safari → Archivo → **Añadir al Dock**.

## Atajos «Universidad ON / OFF»

En la app Atajos (iPhone o Mac):

- **Universidad ON**: acción «Activar/desactivar Concentración» → *Activar* «Universidad» → *Hasta que se desactive*.
- **Universidad OFF**: la misma acción → *Desactivar* «Universidad».

En Ajustes → Concentración → Universidad puedes silenciar apps y personas, y añadir filtros (por ejemplo, un perfil de Safari sin redes sociales). Activa también **Compartir entre dispositivos** para que se encienda a la vez en el Mac.

## Local

```
DATABASE_URL=postgres://… APP_PASSWORD=… npm start
```
