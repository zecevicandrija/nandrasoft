import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import masterDataRouter from "./routes/masterData.js";
import assignmentsRouter from "./routes/assignments.js";
import fieldWorkRouter from "./routes/fieldWork.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Sigurnosna HTTP zaglavlja (Helmet - štiti od XSS, clickjacking, MIME sniffing itd.)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS - dozvoli frontend na localhost:5173
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// Globalni rate limiter prilagođen za deljenu kompanijsku mrežu / WiFi (NAT)
// Omogućava nesmetan istovremeni rad desetinama radnika sa iste IP adrese (npr. 3000 req / 15 min)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Prekoračen broj zahteva sa vaše mreže. Molimo sačekajte koji minut." },
});
app.use(globalLimiter);

// Auth rate limiter:
// - skipSuccessfulRequests: true -> USPEŠNA logovanja radnika na smeni NE troše kvotu
// - Broje se samo NEUSPEŠNI pokušaji sa pogrešnim lozinkama (max 60 pogrešnih pokušaja u 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Previše neuspešnih pokušaja prijave sa vaše mreže. Molimo sačekajte 15 minuta." },
});
app.use("/api/auth/sign-in", authLimiter);
app.use("/api/auth/sign-up", authLimiter);

// Better Auth - sve /api/auth/* rute (pre body parsera jer sam handluje request)
app.all("/api/auth/{*splat}", toNodeHandler(auth));

// JSON body parser za ostale rute
app.use(express.json());

// API rute
app.use("/api/users", usersRouter);
app.use("/api/master", masterDataRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/field-work", fieldWorkRouter);

// Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`✅ NANDRA Backend pokrenut na http://localhost:${PORT}`);
});

export default app;
