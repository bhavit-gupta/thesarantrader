const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const multer = require('multer');
const path = require('path');
const { compressImage } = require('../utils/upload.utils');

// Configure Multer for Screenshot Uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/payments'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'payment-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit (effectively unrestricted)
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|webp/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Only images (jpeg, jpg, png, webp) are allowed"));
    }
});

// Submit Payment Proof
router.post('/api/payment/submit-proof',
    (req, res, next) => {
        upload.single('screenshot')(req, res, (err) => {
            if (err) {
                console.error("Multer/Upload Error:", err);
                return res.status(400).json({ success: false, message: err.message || "File upload failed" });
            }
            next();
        });
    },
    async (req, res) => {
        try {


            if (!req.session.user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const { courseId } = req.body;
            const file = req.file;



            if (!courseId || !file) {
                return res.status(400).json({ success: false, message: "Course ID and Screenshot are required" });
            }

            // Check if course exists
            const course = await prisma.course.findUnique({ where: { id: courseId } });
            if (!course) {
                return res.status(404).json({ success: false, message: "Course not found" });
            }

            // Check if already purchased or pending
            const existingPurchase = await prisma.purchase.findFirst({
                where: {
                    userId: req.session.user.id,
                    courseId: courseId,
                    status: {
                        in: ['completed', 'pending']
                    }
                }
            });

            if (existingPurchase) {
                if (existingPurchase.status === 'pending') {
                    return res.status(400).json({ success: false, message: "Verification in progress. Please wait for admin approval." });
                }
                return res.status(400).json({ success: false, message: "You have already purchased this course" });
            }

            // Clear any old rejected purchases for this course before creating a new one
            await prisma.purchase.deleteMany({
                where: {
                    userId: req.session.user.id,
                    courseId: courseId,
                    status: 'rejected'
                }
            });

            // Compress Payment Screenshot
            const paymentUploadDir = path.join(__dirname, '../public/uploads/payments');
            const compressedFilename = await compressImage(file, paymentUploadDir);

            // Create Pending Purchase
            await prisma.purchase.create({
                data: {
                    userId: req.session.user.id,
                    courseId: courseId,
                    amount: course.price,
                    paymentMethod: 'manual',
                    screenshotUrl: '/uploads/payments/' + compressedFilename,
                    status: 'pending'
                }
            });

            res.json({ success: true, message: "Payment proof submitted. Waiting for admin approval." });

        } catch (error) {
            console.error("Payment Submission Error:", error);
            res.status(500).json({ success: false, message: "Internal Server Error" });
        }
    });

module.exports = router;
