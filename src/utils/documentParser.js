const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");

const PDF_MIME_TYPE = "application/pdf";
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIN_TEXT_LENGTH_FOR_PDF = Number(process.env.MIN_TEXT_LENGTH_FOR_PDF || 300);
const OCR_FALLBACK_PROVIDER = (process.env.OCR_FALLBACK_PROVIDER || "none").toLowerCase();

// Extract text from PDF
async function extractTextFromPdf(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse.default(dataBuffer);
    return data.text;
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}

// Extract text from DOCX
async function extractTextFromDocx(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    throw new Error(`DOCX parsing failed: ${error.message}`);
  }
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

async function runOcrFallback(filePath, fileType) {
  // Hook point for OCR provider integration (e.g. cloud OCR).
  if (OCR_FALLBACK_PROVIDER === "none") {
    return {
      text: "",
      provider: "none",
      warning:
        "Primary extraction returned low text and OCR fallback is not configured. Set OCR_FALLBACK_PROVIDER to enable it.",
    };
  }

  return {
    text: "",
    provider: OCR_FALLBACK_PROVIDER,
    warning: `OCR provider '${OCR_FALLBACK_PROVIDER}' is not implemented yet for ${fileType}.`,
  };
}

async function extractTextWithFallback(filePath, fileType) {
  const primaryText = await extractTextFromFile(filePath, fileType);
  const normalizedPrimaryText = cleanText(primaryText);

  const extractionMeta = {
    primaryMethod: fileType === PDF_MIME_TYPE ? "pdf-parse" : "mammoth",
    fallbackAttempted: false,
    fallbackUsed: false,
    fallbackProvider: null,
    warning: null,
    textLength: normalizedPrimaryText.length,
  };

  if (fileType !== PDF_MIME_TYPE || normalizedPrimaryText.length >= MIN_TEXT_LENGTH_FOR_PDF) {
    return { text: primaryText, extractionMeta };
  }

  extractionMeta.fallbackAttempted = true;
  const fallbackResult = await runOcrFallback(filePath, fileType);
  extractionMeta.fallbackProvider = fallbackResult.provider;
  extractionMeta.warning = fallbackResult.warning || null;

  const fallbackText = cleanText(fallbackResult.text);
  if (fallbackText.length > normalizedPrimaryText.length) {
    extractionMeta.fallbackUsed = true;
    extractionMeta.textLength = fallbackText.length;
    return { text: fallbackResult.text, extractionMeta };
  }

  return { text: primaryText, extractionMeta };
}

// Extract text from file (PDF or DOCX)
async function extractTextFromFile(filePath, fileType) {
  if (fileType === PDF_MIME_TYPE) {
    return await extractTextFromPdf(filePath);
  } else if (fileType === DOCX_MIME_TYPE) {
    return await extractTextFromDocx(filePath);
  } else {
    throw new Error("Unsupported file type. Use PDF or DOCX.");
  }
}

// Parse candidate data from extracted text
function parseCandidateData(text) {
  // Initialize candidate object
  const candidate = {
    fullName: "",
    email: "",
    phone: "",
    roleApplied: "",
    totalExperience: 0,
    currentCompany: "",
    expectedCTC: "",
    currentLocation: "",
    summary: "",
    skills: [],
  };

  // Extract email (pattern: xxx@xxx.xxx)
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    candidate.email = emailMatch[0].toLowerCase();
  }

  // Extract phone (10 digits, possibly with country code or formatting)
  const phoneMatch = text.match(/(?:\+91[-.\s]?|0)?[6-9]\d{9}/);
  if (phoneMatch) {
    candidate.phone = phoneMatch[0].replace(/[-.\s]/g, "");
  }

  // Extract name (first line or first meaningful text)
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    candidate.fullName = lines[0].trim().substring(0, 100);
  }

  // Extract experience (look for patterns like "3 years", "5+ years")
  const expMatch = text.match(/(\d+)\+?\s*(?:years?|yrs?|y\.?)\s+(?:of\s+)?experience/i);
  if (expMatch) {
    candidate.totalExperience = parseInt(expMatch[1]) || 0;
  }

  // Extract skills (look for "Skills:", "Technical Skills:" etc.)
  const skillsMatch = text.match(
    /(?:skills?|technical\s+skills?|expertise|technologies?)[:\-]{0,2}\s*([^\.]+?)(?=\n|$)/i
  );
  if (skillsMatch) {
    const skillsText = skillsMatch[1];
    const skillsArray = skillsText
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 50)
      .slice(0, 15);
    candidate.skills = skillsArray;
  }

  // Extract location (look for "Location:", "Based in:", etc.)
  const locationMatch = text.match(/(?:location|based|city)[:\-]{0,2}\s*([^\.`,\n]+)/i);
  if (locationMatch) {
    candidate.currentLocation = locationMatch[1].trim().substring(0, 100);
  }

  // Extract current company (look for "Currently at:", "Company:", etc.)
  const companyMatch = text.match(
    /(?:currently\s+(?:at|working\s+at)|company|current\s+employer)[:\-]{0,2}\s*([^\.`,\n]+)/i
  );
  if (companyMatch) {
    candidate.currentCompany = companyMatch[1].trim().substring(0, 100);
  }

  // Extract expected salary/CTC
  const ctcMatch = text.match(/(?:expected|ctc|salary)[:\s]*(?:rs|₹)?\s*([0-9,\.]+)\s*(?:lpa|per\s+annum)?/i);
  if (ctcMatch) {
    candidate.expectedCTC = ctcMatch[1].trim();
  }

  // Extract summary (first substantial paragraph)
  const paragraphs = text
    .split(/\n\n+/)
    .filter((p) => p.trim().length > 20 && !p.includes("@") && !p.match(/\d{3,}/));
  if (paragraphs.length > 0) {
    candidate.summary = paragraphs[0].trim().substring(0, 500);
  }

  // Try to detect role applied from text
  const commonRoles = [
    "Developer",
    "Engineer",
    "Manager",
    "Designer",
    "Analyst",
    "Architect",
    "Lead",
    "Senior",
    "Junior",
  ];
  const roleMatch = text.match(
    new RegExp(`(?:${commonRoles.join("|")})\\s+(?:Engineer|Developer|Manager|Designer)?`, "i")
  );
  if (roleMatch) {
    candidate.roleApplied = roleMatch[0].trim();
  }

  const fieldConfidence = {
    fullName: candidate.fullName ? 0.65 : 0,
    email: candidate.email ? 0.95 : 0,
    phone: candidate.phone ? 0.9 : 0,
    roleApplied: candidate.roleApplied ? 0.55 : 0,
    totalExperience: candidate.totalExperience > 0 ? 0.75 : 0,
    currentCompany: candidate.currentCompany ? 0.6 : 0,
    expectedCTC: candidate.expectedCTC ? 0.5 : 0,
    currentLocation: candidate.currentLocation ? 0.6 : 0,
    summary: candidate.summary ? (candidate.summary.length > 80 ? 0.65 : 0.45) : 0,
    skills:
      candidate.skills.length > 0
        ? Math.min(0.9, 0.4 + candidate.skills.length * 0.08)
        : 0,
  };

  const scores = Object.values(fieldConfidence);
  const total = scores.reduce((sum, score) => sum + score, 0);
  const overallConfidence = Number((total / scores.length).toFixed(2));

  return {
    candidate,
    confidence: {
      overall: overallConfidence,
      fields: fieldConfidence,
    },
  };
}

module.exports = {
  extractTextFromFile,
  extractTextWithFallback,
  parseCandidateData,
  PDF_MIME_TYPE,
  DOCX_MIME_TYPE,
};
