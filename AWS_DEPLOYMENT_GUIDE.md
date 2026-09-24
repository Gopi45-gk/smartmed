# SmartMed AWS Production Deployment Guide

This guide walks you through deploying **SmartMed** (React 19 Frontend + FastAPI AI Inference Backend + Offline OCR + Multilingual Voice Bot) to **Amazon Web Services (AWS)**.

---

## 1. AWS Hardware & Architecture Recommendations

SmartMed runs local machine learning models (Qwen2.5-0.5B MNN LLM, Fine-Tuned TrOCR handwriting model, PaddleOCR, Faster-Whisper, and Piper TTS). 

| Deployment Tier | AWS Instance Type | Specifications | Estimated Cost | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **Recommended CPU** | **`t3.xlarge`** | 4 vCPU, 16 GB RAM | ~$0.166 / hr (~$120 / mo) | General production, highly reliable CPU inference |
| **High Compute CPU** | **`c5a.2xlarge`** | 8 vCPU, 16 GB RAM | ~$0.308 / hr (~$220 / mo) | Faster OCR and LLM responses on CPU |
| **High-Speed GPU** | **`g4dn.xlarge`** | 4 vCPU, 16 GB RAM, 1x NVIDIA T4 (16GB VRAM) | ~$0.526 / hr (~$380 / mo) | Real-time sub-second GPU inference (CUDA) |

> [!CAUTION]
> **Do not use `t2.micro` or `t3.small`**: Instances with less than 8 GB RAM will crash with Out-Of-Memory (OOM) errors when loading PyTorch and deep learning vision models.

---

## 2. Deployment Methods

Choose the method that matches your preferred workflow:
- **[Method A: 1-Click AWS CloudFormation (Easiest)](#method-a-1-click-aws-cloudformation-easiest)**
- **[Method B: Manual EC2 Launch + 1-Command Script](#method-b-manual-ec2-launch--1-command-script)**

---

### Method A: 1-Click AWS CloudFormation (Easiest)

We provide a ready-to-use CloudFormation template: [`aws/smartmed-cloudformation.yaml`](aws/smartmed-cloudformation.yaml).

1. Log into your **[AWS Management Console](https://console.aws.amazon.com/)**.
2. Navigate to **CloudFormation** → Click **Create stack** (With new resources).
3. Under **Template source**, select **Upload a template file** and upload:
   ```
   aws/smartmed-cloudformation.yaml
   ```
4. Click **Next** and fill in the parameters:
   - **Stack name**: `smartmed-production`
   - **InstanceType**: `t3.xlarge` (or `g4dn.xlarge`)
   - **KeyName**: Select your existing EC2 Key Pair (for SSH access)
   - **GitRepoUrl**: `https://github.com/Gopi45-gk/smartmed.git`
5. Click **Next** → **Next** → Check the acknowledgment box → Click **Submit**.
6. CloudFormation will automatically:
   - Create the Security Group (ports `80`, `443`, `22`).
   - Launch the Ubuntu 24.04 instance with a 50 GB SSD.
   - Install Docker, clone the project, build containers, and launch SmartMed!
7. Once the stack status reaches **`CREATE_COMPLETE`** (~3-5 minutes), check the **Outputs** tab for your live URL:
   - **WebUrl**: `http://<EC2-PUBLIC-IP>`

---

### Method B: Manual EC2 Launch + 1-Command Script

If you prefer launching an EC2 instance directly from the EC2 Console:

#### Step 1: Launch an EC2 Instance
1. In the AWS Console, open **EC2** → Click **Launch Instance**.
2. **Name**: `smartmed-server`
3. **Application and OS Images**: Choose **Ubuntu 24.04 LTS (HVM), SSD Volume Type**.
4. **Instance Type**: Select `t3.xlarge` (or `c5a.2xlarge` / `g4dn.xlarge`).
5. **Key pair**: Select or create an SSH key pair (e.g., `smartmed-key.pem`).
6. **Network settings (Security Group)**:
   - Check **Allow SSH traffic from** (Your IP or Anywhere).
   - Check **Allow HTTP traffic from the internet** (Port 80).
   - Check **Allow HTTPS traffic from the internet** (Port 443).
7. **Configure Storage**:
   - Set root volume to **`50 GiB`** (gp3).
8. Click **Launch instance**.

#### Step 2: SSH and Deploy
Once the instance is running:

```bash
# 1. Connect to your EC2 instance
ssh -i /path/to/smartmed-key.pem ubuntu@<YOUR-EC2-PUBLIC-IP>

# 2. Clone the repository
git clone https://github.com/Gopi45-gk/smartmed.git
cd smartmed

# 3. Run the automated deployment script
sudo ./aws/deploy-ec2.sh
```

The script will automatically:
- Configure a 4GB swap space to guarantee system stability.
- Install Docker Engine and Docker Compose v2.
- Build the production React static bundle and Nginx reverse proxy.
- Build the Python FastAPI AI inference backend.
- Start the entire system in the background (`docker compose up -d`).

Once completed, access your server at:
```
http://<YOUR-EC2-PUBLIC-IP>
```

---

## 3. Enable Free HTTPS / SSL (Crucial for Microphone Access)

> [!IMPORTANT]
> Modern web browsers (Chrome, Edge, Safari, Firefox) **block microphone access** unless the website is loaded over **HTTPS** or on `localhost`. To use the Voice Call Bot and Speech Recognition on remote phones and laptops, you must enable HTTPS.

### Step 1: Point your Domain to the EC2 IP
In your DNS provider (e.g. AWS Route 53, GoDaddy, Cloudflare, Namecheap):
- Create an **`A` record**:
  - **Name**: `smartmed` (or `@`)
  - **Value**: `<YOUR-EC2-PUBLIC-IP>`
  - Example: `smartmed.yourdomain.com`

### Step 2: Run the 1-Step SSL Setup Script
On your EC2 instance:

```bash
cd smartmed
sudo ./aws/setup-ssl.sh smartmed.yourdomain.com your-email@example.com
```

The script will automatically:
1. Obtain a free SSL certificate from **Let's Encrypt**.
2. Configure Nginx with TLS 1.3, HTTP/2, and automatic HTTP-to-HTTPS redirect.
3. Restart the containers with HTTPS enabled on port 443.

You can now visit:
```
https://smartmed.yourdomain.com
```
All microphone and voice call simulation features will now function securely!

---

## 4. Useful Management Commands

All operations can be managed via standard Docker Compose:

| Action | Command |
| :--- | :--- |
| **View Live Logs** | `docker compose logs -f` |
| **View Backend Logs Only** | `docker compose logs -f backend` |
| **View Frontend Nginx Logs** | `docker compose logs -f frontend` |
| **Check Container Status** | `docker compose ps` |
| **Restart Services** | `docker compose restart` |
| **Stop Stack** | `docker compose down` |
| **Update Code & Rebuild** | `git pull && docker compose up -d --build` |

---

## 5. Cost Optimization Tips

1. **Use EC2 Spot Instances**: In the EC2 Launch Wizard under *Advanced details*, enable **Request Spot Instances**. Spot instances offer **up to 70% discount** compared to On-Demand prices.
2. **Stop Instance When Inactive**: If running SmartMed for demonstrations or periodic testing, stop the instance from the AWS Console when not in use. You will only pay a few cents per month for EBS storage while stopped.
3. **AWS Savings Plans / Reserved Instances**: If running SmartMed 24/7 for a clinic or hospital, purchasing a 1-year Compute Savings Plan reduces EC2 costs by ~35-40%.
