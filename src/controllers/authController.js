const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

async function ensureDefaultAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";

  const existingAdmin = await Admin.findOne({ email: adminEmail });
  if (existingAdmin) return;

  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  await Admin.create({ email: adminEmail, password: hashedPassword });
  console.log("Default admin created:", adminEmail);
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      token,
      admin: { email: admin.email },
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
}

module.exports = { login, ensureDefaultAdmin };
