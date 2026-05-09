const Candidate = require("../models/Candidate");
const fs = require("fs");
const path = require("path");

function getResumeDiskPath(resumeUrl) {
  if (!resumeUrl || !resumeUrl.startsWith("/uploads/resumes/")) return null;
  const fileName = resumeUrl.replace("/uploads/resumes/", "");
  return path.join(__dirname, "..", "..", "uploads", "resumes", fileName);
}

function deleteResumeIfExists(resumeUrl) {
  const diskPath = getResumeDiskPath(resumeUrl);
  if (diskPath && fs.existsSync(diskPath)) {
    fs.unlinkSync(diskPath);
  }
}

function normalizeCsvToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function createCandidate(req, res) {
  try {
    const payload = {
      ...req.body,
      skills: normalizeCsvToArray(req.body.skills),
    };

    const candidate = await Candidate.create(payload);
    return res.status(201).json(candidate);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Candidate create failed", error: error.message });
  }
}

async function getCandidates(req, res) {
  try {
    const { search = "" } = req.query;
    const query = search
      ? {
          $or: [
            { fullName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
            { roleApplied: { $regex: search, $options: "i" } },
            { skills: { $elemMatch: { $regex: search, $options: "i" } } },
          ],
        }
      : {};

    const candidates = await Candidate.find(query).sort({ createdAt: -1 });
    return res.json(candidates);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Fetch candidates failed", error: error.message });
  }
}

async function getCandidateById(req, res) {
  try {
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }
    return res.json(candidate);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Fetch candidate failed", error: error.message });
  }
}

async function updateCandidate(req, res) {
  try {
    const payload = {
      ...req.body,
      skills: normalizeCsvToArray(req.body.skills),
    };

    const candidate = await Candidate.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    return res.json(candidate);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Update candidate failed", error: error.message });
  }
}

async function deleteCandidate(req, res) {
  try {
    const candidate = await Candidate.findByIdAndDelete(req.params.id);
    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    deleteResumeIfExists(candidate.resumeUrl);
    return res.json({ message: "Candidate deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Delete candidate failed", error: error.message });
  }
}

async function uploadResume(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Resume file (PDF or DOCX) is required" });
    }

    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ message: "Candidate not found" });
    }

    deleteResumeIfExists(candidate.resumeUrl);

    candidate.resumeUrl = `/uploads/resumes/${req.file.filename}`;
    await candidate.save();

    return res.json({
      message: "Resume uploaded successfully",
      resumeUrl: candidate.resumeUrl,
      candidate,
    });
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Resume upload failed", error: error.message });
  }
}

async function scheduleInterview(req, res) {
  try {
    const { dateTime, mode, interviewer, notes } = req.body;
    if (!dateTime || !interviewer) {
      return res.status(400).json({ message: "dateTime and interviewer are required" });
    }

    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    candidate.interviews.push({
      dateTime,
      mode,
      interviewer,
      notes,
      status: "Scheduled",
    });

    await candidate.save();

    return res.status(201).json(candidate);
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Schedule interview failed", error: error.message });
  }
}

async function getUpcomingInterviews(req, res) {
  try {
    const candidates = await Candidate.find({ "interviews.0": { $exists: true } })
      .select("fullName roleApplied interviews")
      .lean();

    const flattened = [];

    candidates.forEach((candidate) => {
      candidate.interviews.forEach((interview) => {
        flattened.push({
          candidateId: candidate._id,
          candidateName: candidate.fullName,
          roleApplied: candidate.roleApplied,
          ...interview,
        });
      });
    });

    flattened.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
    return res.json(flattened);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Fetch interviews failed", error: error.message });
  }
}

async function updateInterviewStatus(req, res) {
  try {
    const { status } = req.body;
    if (!["Scheduled", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid interview status" });
    }

    const candidate = await Candidate.findById(req.params.candidateId);
    if (!candidate) {
      return res.status(404).json({ message: "Candidate not found" });
    }

    const interview = candidate.interviews.id(req.params.interviewId);
    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }

    interview.status = status;
    await candidate.save();

    return res.json({
      message: "Interview status updated successfully",
      interview,
    });
  } catch (error) {
    return res
      .status(400)
      .json({ message: "Update interview status failed", error: error.message });
  }
}

module.exports = {
  createCandidate,
  getCandidates,
  getCandidateById,
  updateCandidate,
  deleteCandidate,
  uploadResume,
  scheduleInterview,
  getUpcomingInterviews,
  updateInterviewStatus,
};
