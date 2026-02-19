/* ---------------- DEPENDENCIES ---------------- */
const prisma = require('../utils/prisma');

/* ---------------- MIDDLEWARE LOGIC ---------------- */
const singleSessionMiddleware = async (req, res, next) => {
    // Only check if user is logged in
    if (req.session && req.session.user && req.session.user.id) {
        try {
            // Fetch only currentSessionId to minimize payload
            const user = await prisma.user.findUnique({
                where: { id: req.session.user.id },
                select: { currentSessionId: true }
            });

            if (!user) {
                // User might have been deleted
                return req.session.destroy(() => {
                    res.redirect('/login');
                });
            }

            // If currentSessionId exists in DB and doesn't match current session
            if (user.currentSessionId && user.currentSessionId !== req.sessionID) {
                console.warn(`📡 [Single Session] Device mismatch for ${req.session.user.username}. Logging out old session.`);

                // Explicitly destroy the old session
                return req.session.destroy((err) => {
                    if (err) console.error("Error destroying session during enforcement:", err);
                    res.redirect('/login?error=You+have+been+logged+out+because+you+logged+in+on+another+device.');
                });
            }

        } catch (error) {
            console.error("Error in singleSessionMiddleware:", error);
            // Optionally decide if error should block access. For now, log and proceed to avoid locking out on DB transient errors.
        }
    }
    next();
};

module.exports = singleSessionMiddleware;
