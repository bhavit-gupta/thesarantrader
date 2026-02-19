/* -------------------------------------------------------------------------- */
/*                                CONFIGURATION                               */
/* -------------------------------------------------------------------------- */

require('dotenv').config(); // Load environment variables from .env

const app = require('./app');
const PORT = process.env.PORT || 3000;

/* -------------------------------------------------------------------------- */
/*                               SCHEDULER BOOT                               */
/* -------------------------------------------------------------------------- */

const { initScheduler } = require('./utils/scheduler.js');
initScheduler(); // Start background tasks (e.g., daily cleanups)

/* -------------------------------------------------------------------------- */
/*                                SERVER START                                */
/* -------------------------------------------------------------------------- */

app.listen(PORT, () => {
    console.log(`
🚀 SERVER READY
----------------------------------------
Local:   http://localhost:${PORT}
Status:  Listening for requests...
----------------------------------------
    `);
});