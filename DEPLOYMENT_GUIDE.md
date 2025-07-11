# GABTA Database Deployment Guide

## Quick Deploy to Google Cloud Run (No CLI Required)

### Method 1: Direct from GitHub (Recommended)

1. **Go to Cloud Run Console**
   - Visit: https://console.cloud.google.com/run
   - Make sure you're in project: `alert-brook-272309`

2. **Click "Create Service"**

3. **Choose "Continuously deploy from a repository"**
   - Click "Set up with Cloud Build"

4. **Connect GitHub Repository**
   - Repository Provider: GitHub
   - Click "Authenticate" and authorize Google Cloud
   - Select repository: `GDataLabs/database_demo`
   - Branch: `main`

5. **Configure Build**
   - Build Type: **Dockerfile**
   - Source location: `/` (root)
   - Dockerfile location: `Dockerfile`

6. **Configure Service**
   - Service name: `gabta-database-demo`
   - Region: `us-central1`
   - CPU allocation: "CPU is only allocated during request processing"
   - Memory: `1 GiB`
   - CPUs: `1`
   - Request timeout: `300`
   - Maximum instances: `3`

7. **Authentication**
   - ✅ Check "Allow unauthenticated invocations"

8. **Environment Variables** (Click "Variables & Secrets" tab)
   Add these if you have them (optional for demo):
   - `PINECONE_API_KEY`: Your Pinecone API key
   - `PINECONE_INDEX_NAME`: Your Pinecone index
   - `GEMINI_PROJECT_ID`: alert-brook-272309
   - `GEMINI_LOCATION`: us-central1

9. **Click "Create"**

The first deployment will take 5-10 minutes. After that, it will auto-deploy on every push to GitHub!

### Method 2: Upload Source Code Directly

1. **Download the code**
   - Go to: https://github.com/GDataLabs/database_demo
   - Click "Code" → "Download ZIP"
   - Extract the ZIP file

2. **Go to Cloud Run**
   - Visit: https://console.cloud.google.com/run

3. **Click "Create Service"**

4. **Choose "Deploy one revision from an existing container image"**
   - Click "Deploy from source code instead"

5. **Upload Source**
   - Click "Browse" and select the extracted folder
   - Or drag and drop the folder

6. **Configure** (same as Method 1, steps 6-8)

7. **Click "Create"**

## After Deployment

1. **Access Your App**
   - Cloud Run will provide a URL like: `https://gabta-database-demo-xxxxx-uc.a.run.app`
   - Click the URL to access your app

2. **Demo Credentials**
   - Instructor: `instructor@demo.com` / `demo123`
   - Director: `director@demo.com` / `demo123`

3. **Important Notes**
   - This uses SQLite (data resets on restart)
   - Demo users are auto-created on startup
   - For production, use Cloud SQL instead

## Troubleshooting

- **Build fails**: Check Cloud Build logs in the console
- **App won't start**: Check Cloud Run logs
- **Can't login**: Wait 30 seconds after deployment for demo users to be created

## Cost Estimate
- Within free tier limits for demo usage
- Actual cost: ~$0.10-1.00/month for light use
- Main costs: Container storage and compute time