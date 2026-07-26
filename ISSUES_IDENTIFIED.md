# ⚠️ FORGE - ISSUES IDENTIFIED & SOLUTIONS

**Date:** July 26, 2024  
**Status:** ⚠️ Issues found - Fixable

---

## 🔴 IDENTIFIED ISSUES

### Issue 1: SSH Directory Not Found ❌
**Error:** `ENOENT: no such file or directory, open '/home/dev/.ssh'`

**Location:** 
- orchestrator service logs
- happening on workspace SSH setup

**Root Cause:**
Workspace containers don't have `/home/dev/.ssh` directory created during image build

**Impact:**
- SSH key setup failing
- Remote SSH access not working
- But basic terminal still works ✅

---

### Issue 2: Idle Reaper Stopping Workspaces ⚠️
**What happened:**
```
[idleReaper] Stopping idle workspace 6a65b09a46b5b5547d4ad84e (my) 
- idle for 33min (timeout: 30min)
```

**Root Cause:**
- Workspace idle timeout set to 30 minutes
- Test workspace was idle, so it got stopped automatically

**Impact:**
- Workspace stopped after 30 minutes of inactivity
- This is EXPECTED behavior (feature, not bug!)
- But confusing if you're not expecting it

---

### Issue 3: SMTP Not Configured ⚠️
**Warning:**
```
[email] SMTP_HOST not set in .env - emails will be logged instead
[email] would send "Welcome to Forge" to test@local.com
```

**Root Cause:**
- .env file doesn't have SMTP configuration
- Email feature is optional in development

**Impact:**
- Emails not being sent (logged to console instead)
- Expected for local dev ✅
- Need SMTP config for production

---

## ✅ SOLUTIONS

### Fix 1: Create SSH Directory in Workspace Image

**Step 1:** Update orchestrator/Dockerfile

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache openssh-client openssh-server

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Pre-create SSH directory
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

EXPOSE 5001
CMD ["node", "server.js"]
```

**Step 2:** Update docker/base.Dockerfile (workspace image)

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    openssh-server \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Create dev user with home directory and .ssh
RUN useradd -m -s /bin/bash dev && \
    mkdir -p /home/dev/.ssh && \
    chmod 700 /home/dev/.ssh && \
    chown dev:dev /home/dev/.ssh

# Pre-create .ssh directory for root
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh

WORKDIR /home/dev/workspace

EXPOSE 22
CMD ["/home/dev/entrypoint.sh"]
```

**Step 3:** Rebuild images

```bash
docker compose exec backend npm run seed:images
# OR
docker compose build --no-cache
```

---

### Fix 2: Configure Idle Timeout (Optional)

**If you want to disable idle stopping:**

Edit `.env`:
```
IDLE_TIMEOUT_MINUTES=0  # 0 = disabled
```

**Or keep current setting (30 min):**
This is good for production to save resources.

---

### Fix 3: Configure SMTP for Email (Optional for Prod)

**Step 1:** Get SMTP credentials (SendGrid example):

```bash
# Go to SendGrid dashboard
# Create API key
# Copy email address
```

**Step 2:** Update `.env`:

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
EMAIL_FROM=noreply@yourdomain.com
```

**Step 3:** Restart backend:

```bash
docker compose restart backend
```

---

## 📋 QUICK FIX CHECKLIST

### For SSH Issues (High Priority for Phase 2)

- [ ] Update docker/base.Dockerfile with SSH directory creation
- [ ] Update orchestrator/Dockerfile with SSH directory
- [ ] Rebuild workspace images: `npm run seed:images`
- [ ] Test SSH: Create new workspace and test SSH access

### For Idle Timeout (Low Priority)

- [ ] Update .env with `IDLE_TIMEOUT_MINUTES=0` if you want to disable
- [ ] OR keep 30 min (recommended for production)

### For Email (Medium Priority for Production)

- [ ] Get SMTP credentials (SendGrid, AWS SES, etc.)
- [ ] Update .env with SMTP_* variables
- [ ] Restart backend
- [ ] Test email by creating new user

---

## 🔧 IMPLEMENTATION

### Option A: Quick Local Fix

```bash
# Don't rebuild everything, just fix and restart
cd orchestrator
# Edit Dockerfile: add mkdir -p /root/.ssh
# Then:
docker compose build orchestrator --no-cache
docker compose restart orchestrator
```

### Option B: Full Rebuild

```bash
# Rebuild everything cleanly
docker compose down -v
docker compose build --no-cache
docker compose up -d
docker compose exec backend npm run seed:images
```

### Option C: Use Provided Dockerfiles

Dockerfiles should already have these fixes. Just rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

---

## 📊 CURRENT STATUS

| Issue | Severity | Status | Impact |
|-------|----------|--------|--------|
| SSH Directory | Medium | ⚠️ Fixable | SSH not working |
| Idle Reaper | Low | ✅ Expected | Workspaces stop after 30min |
| SMTP Config | Low | ⚠️ Optional | Emails not sent (dev only) |

---

## 🎯 VERIFICATION

After fixes:

```bash
# 1. Check containers
docker compose ps

# 2. Check logs (should have no SSH errors)
docker compose logs orchestrator | grep "ssh"

# 3. Create new workspace
curl -X POST http://localhost:4000/api/workspaces \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"test2","image":"cloud-dev-base:latest"}'

# 4. Try SSH access (should work now)
# Get SSH port from workspace
# ssh -i ~/.forge/keys/{workspace_id} dev@localhost -p {port}
```

---

## 🚀 NEXT STEPS

1. **Apply SSH directory fix** (rebuild images)
2. **Test SSH access** with new workspace
3. **Configure SMTP** if needed
4. **Test email** by creating user
5. **Deploy to production** with these fixes

---

**All issues are fixable. Project is not "broken" - these are expected operational issues that need small fixes!**

Generated: July 26, 2024
