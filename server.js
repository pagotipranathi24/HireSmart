
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const db = require("./db");

const execFileAsync = promisify(execFile);
const app = express();
const PORT = 5000;
const database = db.promise();

app.use(cors());
app.use(express.json());

const uploadFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

// ------------------------------------
// 1. HEALTH CHECK
// ------------------------------------

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "HireSmart backend is running!"
    });
});

// ------------------------------------
// 2. GET ALL JOBS
// ------------------------------------

app.get("/api/jobs", async (req, res) => {
    try {
        const [jobs] = await database.query(
            "SELECT * FROM jobs ORDER BY created_at DESC"
        );

        const [skills] = await database.query(
            "SELECT * FROM job_skills"
        );

        const formattedJobs = jobs.map(job => ({
            id: job.id,
            title: job.title,
            qualification: job.education,
            experience: job.experience,
            createdAt: job.created_at,
            skills: skills
                .filter(skill => skill.job_id === job.id)
                .map(skill => ({
                    name: skill.skill_name,
                    weight: skill.weight
                }))
        }));

        res.json({
            success: true,
            jobs: formattedJobs
        });

    } catch (error) {
        console.error("Loading jobs failed:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load jobs.",
            error: error.message
        });
    }
});

// ------------------------------------
// 3. CREATE JOB
// ------------------------------------

app.post("/api/jobs", async (req, res) => {
    const {
        title,
        qualification,
        experience,
        skills
    } = req.body;

    if (
        !title ||
        !qualification ||
        !experience ||
        !Array.isArray(skills) ||
        skills.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Please provide all job details and skills."
        });
    }

    const totalWeight = skills.reduce(
        (total, skill) => total + Number(skill.weight),
        0
    );

    if (
        skills.some(skill =>
            !skill.name ||
            !Number.isFinite(Number(skill.weight)) ||
            Number(skill.weight) < 0
        ) ||
        totalWeight !== 100
    ) {
        return res.status(400).json({
            success: false,
            message: "Skill weights must total exactly 100%."
        });
    }

    let connection;

    try {
        connection = await database.getConnection();
        await connection.beginTransaction();

        const [jobResult] = await connection.execute(
            `INSERT INTO jobs (title, education, experience)
             VALUES (?, ?, ?)`,
            [title, qualification, experience]
        );

        const jobId = jobResult.insertId;

        for (const skill of skills) {
            await connection.execute(
                `INSERT INTO job_skills
                 (job_id, skill_name, weight)
                 VALUES (?, ?, ?)`,
                [jobId, skill.name.trim(), Number(skill.weight)]
            );
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: "Job saved successfully!",
            job: {
                id: jobId,
                title,
                qualification,
                experience,
                skills
            }
        });

    } catch (error) {
        if (connection) await connection.rollback();

        console.error("Saving job failed:", error);

        res.status(500).json({
            success: false,
            message: "Unable to save job.",
            error: error.message
        });

    } finally {
        if (connection) connection.release();
    }
});

// ------------------------------------
// 4. DELETE JOB
// ------------------------------------

app.delete("/api/jobs/:id", async (req, res) => {
    const jobId = Number(req.params.id);
    let connection;

    if (!Number.isInteger(jobId) || jobId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid job ID."
        });
    }

    try {
        connection = await database.getConnection();
        await connection.beginTransaction();

        const [jobs] = await connection.execute(
            "SELECT id FROM jobs WHERE id = ? FOR UPDATE",
            [jobId]
        );

        if (jobs.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Job not found."
            });
        }

        const [applications] = await connection.execute(
            "SELECT id FROM applications WHERE job_id = ? LIMIT 1",
            [jobId]
        );

        if (applications.length > 0) {
            await connection.rollback();

            return res.status(409).json({
                success: false,
                message: "This job has applications and cannot be deleted."
            });
        }

        await connection.execute(
            "DELETE FROM job_skills WHERE job_id = ?",
            [jobId]
        );

        await connection.execute(
            "DELETE FROM jobs WHERE id = ?",
            [jobId]
        );

        await connection.commit();

        res.json({
            success: true,
            message: "Job deleted successfully!"
        });

    } catch (error) {
        if (connection) await connection.rollback();

        res.status(500).json({
            success: false,
            message: "Unable to delete job.",
            error: error.message
        });

    } finally {
        if (connection) connection.release();
    }
});

// ------------------------------------
// 5. RESUME UPLOAD CONFIGURATION
// ------------------------------------

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadFolder);
    },

    filename: (req, file, cb) => {
        const uniqueName =
            Date.now() + "-" +
            Math.round(Math.random() * 1e9);

        cb(
            null,
            uniqueName +
            path.extname(file.originalname).toLowerCase()
        );
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = [".pdf", ".doc", ".docx", ".txt"];
    const extension = path.extname(file.originalname).toLowerCase();

    if (allowed.includes(extension)) {
        cb(null, true);
    } else {
        cb(new Error("Unsupported resume format."));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

// ------------------------------------
// 6. UPLOAD AND EXTRACT RESUMES
// ------------------------------------

app.post(
    "/api/upload-resumes",
    upload.array("resumes", 50),
    async (req, res) => {

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please upload at least one resume."
            });
        }

        const jobId = Number(req.body.jobId);
        let connection;

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Please select a valid job."
            });
        }

        try {
            const [jobs] = await database.execute(
                "SELECT id FROM jobs WHERE id = ?",
                [jobId]
            );

            if (jobs.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Selected job was not found."
                });
            }

            const pythonScript = path.join(
                __dirname,
                "..",
                "ml",
                "extract_api.py"
            );

            const pythonArguments = [];

            req.files.forEach(file => {
                pythonArguments.push(file.path, file.originalname);
            });

            const { stdout } = await execFileAsync(
                "python",
                [pythonScript, ...pythonArguments],
                { maxBuffer: 10 * 1024 * 1024 }
            );

            const extracted = JSON.parse(stdout);
            const savedCandidates = [];

            connection = await database.getConnection();

            for (let i = 0; i < extracted.length; i++) {
                const item = extracted[i];

                if (!item.success || !item.candidate) {
                    savedCandidates.push(item);
                    continue;
                }

                const candidate = item.candidate;

                const file = req.files.find(
                    f => f.originalname === item.fileName
                ) || req.files[i];

                await connection.beginTransaction();

                try {
                    const [candidateResult] = await connection.execute(
                        `INSERT INTO candidates
                        (name, email, phone, skills, education,
                         experience, projects, resume_path)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            candidate.name || "",
                            candidate.email || "",
                            candidate.phone || "",
                            JSON.stringify(candidate.skills || []),
                            candidate.education || "",
                            candidate.experience || "",
                            candidate.projects || "",
                            file.path
                        ]
                    );

                    const candidateId = candidateResult.insertId;

                    const [applicationResult] = await connection.execute(
                        `INSERT INTO applications
                        (job_id, candidate_id, score, status)
                        VALUES (?, ?, 0, 'Pending')`,
                        [jobId, candidateId]
                    );

                    await connection.commit();

                    savedCandidates.push({
                        ...item,
                        candidateId,
                        applicationId: applicationResult.insertId,
                        jobId,
                        status: "Pending"
                    });

                } catch (error) {
                    await connection.rollback();
                    throw error;
                }
            }

            res.json({
                success: true,
                message: "Resumes processed and linked to the job!",
                jobId,
                totalResumes: req.files.length,
                successfulCandidates: savedCandidates.filter(
                    item => item.success && item.candidateId
                ).length,
                candidates: savedCandidates
            });

        } catch (error) {
            console.error("Resume processing failed:", error);

            res.status(500).json({
                success: false,
                message: "Resume processing failed.",
                error: error.message
            });

        } finally {
            if (connection) connection.release();
        }
    }
);

// ------------------------------------
// 7. CALCULATE AND SAVE ML SCORES
// ------------------------------------

app.post("/api/jobs/:id/score", async (req, res) => {
    const jobId = Number(req.params.id);

    if (!Number.isInteger(jobId) || jobId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid job ID."
        });
    }

    try {
        // Get required skills for the job
        const [jobSkills] = await database.execute(
            `SELECT skill_name, weight
             FROM job_skills
             WHERE job_id = ?`,
            [jobId]
        );

        if (jobSkills.length === 0) {
            return res.status(400).json({
                success: false,
                message: "This job has no required skills."
            });
        }

        // Get candidates linked to this job
        const [rows] = await database.execute(
            `SELECT
                a.candidate_id,
                c.skills
             FROM applications a
             JOIN candidates c ON c.id = a.candidate_id
             WHERE a.job_id = ?`,
            [jobId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No candidates found for this job."
            });
        }

        const candidates = rows.map(row => {
            let skills = row.skills || [];

            if (typeof skills === "string") {
                try {
                    skills = JSON.parse(skills);
                } catch {
                    skills = [];
                }
            }

            return {
                candidateId: row.candidate_id,
                skills: Array.isArray(skills) ? skills : []
            };
        });

        const payload = {
            jobSkills: jobSkills.map(skill => ({
                name: skill.skill_name,
                weight: Number(skill.weight)
            })),
            candidates
        };

        // Run Python semantic matching engine
        const pythonScript = path.join(
            __dirname,
            "..",
            "ml",
            "score_api.py"
        );

        const { stdout } = await execFileAsync(
            "python",
            [pythonScript, JSON.stringify(payload)],
            { maxBuffer: 20 * 1024 * 1024 }
        );

        const scoringResult = JSON.parse(stdout);

        if (!scoringResult.success) {
            throw new Error(scoringResult.error || "ML scoring failed.");
        }

        // Save calculated scores in MySQL
        const connection = await database.getConnection();

        try {
            await connection.beginTransaction();

            for (const result of scoringResult.results) {
                await connection.execute(
                    `UPDATE applications
                     SET score = ?
                     WHERE job_id = ? AND candidate_id = ?`,
                    [
                        result.score,
                        jobId,
                        result.candidateId
                    ]
                );
            }

            await connection.commit();

        } catch (error) {
            await connection.rollback();
            throw error;

        } finally {
            connection.release();
        }

        res.json({
            success: true,
            message: "Candidate scores calculated and saved!",
            jobId,
            totalCandidates: scoringResult.results.length,
            results: scoringResult.results
        });

    } catch (error) {
        console.error("ML scoring failed:", error);

        res.status(500).json({
            success: false,
            message: "Unable to calculate candidate scores.",
            error: error.message
        });
    }
});

// ------------------------------------
// 8. GET RANKED CANDIDATES
// ------------------------------------

app.get("/api/jobs/:id/candidates", async (req, res) => {
    const jobId = Number(req.params.id);

    if (!Number.isInteger(jobId) || jobId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid job ID."
        });
    }

    try {
        const [candidates] = await database.execute(
            `SELECT
                a.id AS applicationId,
                a.job_id AS jobId,
                a.candidate_id AS candidateId,
                a.score,
                a.status,
                c.name,
                c.email,
                c.phone,
                c.skills,
                c.education,
                c.experience,
                c.projects,
                c.resume_path
             FROM applications a
             JOIN candidates c ON c.id = a.candidate_id
             WHERE a.job_id = ?
             ORDER BY a.score DESC, a.id ASC`,
            [jobId]
        );

        const formattedCandidates = candidates.map(candidate => {
            let skills = candidate.skills || [];

            if (typeof skills === "string") {
                try {
                    skills = JSON.parse(skills);
                } catch {
                    skills = [];
                }
            }

            return {
                ...candidate,
                skills: Array.isArray(skills) ? skills : [],
                score: Number(candidate.score)
            };
        });

        res.json({
            success: true,
            jobId,
            totalCandidates: formattedCandidates.length,
            candidates: formattedCandidates
        });

    } catch (error) {
        console.error("Loading candidates failed:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load ranked candidates.",
            error: error.message
        });
    }
});

// ------------------------------------
// 9. UPDATE CANDIDATE DECISION
// ------------------------------------

app.patch("/api/applications/:id/status", async (req, res) => {
    const applicationId = Number(req.params.id);
    const { status } = req.body;

    const allowedStatuses = [
        "Pending",
        "Selected",
        "Rejected"
    ];

    if (!Number.isInteger(applicationId) || applicationId <= 0) {
        return res.status(400).json({
            success: false,
            message: "Invalid application ID."
        });
    }

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Status must be Pending, Selected or Rejected."
        });
    }

    try {
        const [result] = await database.execute(
            "UPDATE applications SET status = ? WHERE id = ?",
            [status, applicationId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Application not found."
            });
        }

        res.json({
            success: true,
            message: "Candidate status updated successfully!",
            applicationId,
            status
        });

    } catch (error) {
        console.error("Status update failed:", error);

        res.status(500).json({
            success: false,
            message: "Unable to update candidate status.",
            error: error.message
        });
    }
});

// ------------------------------------
// 10. ERROR HANDLING
// ------------------------------------

app.use((err, req, res, next) => {
    console.error("Backend error:", err.message);

    res.status(400).json({
        success: false,
        message: err.message
    });
});

// ------------------------------------
// 11. START SERVER
// ------------------------------------

app.listen(PORT, () => {
    console.log(
        `HireSmart backend running at http://localhost:${PORT}`
    );
});
