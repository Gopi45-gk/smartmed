# SmartMed Commands Cheatsheet

Both the **Frontend** and **Backend** are currently **RUNNING in the background**.

---

## 1. Access the Application
- **Frontend (Vite Dev Server)**: [http://localhost:3000](http://localhost:3000)
- **Frontend (Docker Nginx)**: [http://localhost](http://localhost) (Port 80)
- **AI Backend API**: [http://localhost:8100](http://localhost:8100)
- **API Docs (Swagger UI)**: [http://localhost:8100/docs](http://localhost:8100/docs)
- **Twilio Status Check**: [http://localhost:8100/api/call/status](http://localhost:8100/api/call/status)

---

## 2. Option A: Run via Docker (Recommended)

From the project root (`~/Documents/smart_med`):
```bash
# Start both frontend and backend in background
docker compose up -d

# If you made changes and want to rebuild:
docker compose up -d --build

# View real-time logs:
docker compose logs -f

# Stop containers:
docker compose down
```

---

## 3. Option B: Run Locally via Terminals (Dev Mode)

> **Note**: If Docker is running, stop it first (`docker compose down`) to free port 8100.

### Terminal 1: Backend (AI Server)
```bash
cd ~/Documents/smart_med/ai
python3 server.py
```

### Terminal 2: Frontend (React / Vite)
```bash
cd ~/Documents/smart_med
npm run dev
```

---

## 4. Useful Test Commands

### Health Check
```bash
curl http://localhost:8100/api/ai/health
```

### AI Model Status
```bash
curl http://localhost:8100/api/ai/status
```

### Test AI Chat Inference
```bash
curl -X POST http://localhost:8100/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What should I do if I forget my medicine?"}'
```

---

## 5. Stop / Restart Services (If Needed)

### Check if ports are active
```bash
# Check port 8100 (Backend)
lsof -i :8100

# Check port 3000 (Frontend)
lsof -i :3000
```

### Kill existing processes on ports
```bash
# Stop backend
fuser -k 8100/tcp

# Stop frontend
fuser -k 3000/tcp
```
