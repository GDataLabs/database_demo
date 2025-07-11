#!/bin/bash

# Deploy GABTA Database to Google Cloud Run

PROJECT_ID="your-project-id"  # CHANGE THIS to your Google Cloud project ID
SERVICE_NAME="gabta-database-demo"
REGION="us-central1"

echo "🚀 Deploying GABTA Database to Cloud Run..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo "📝 Please authenticate with Google Cloud:"
    gcloud auth login
fi

# Set the project
echo "🔧 Setting project to: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "🔌 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# Build and deploy
echo "🏗️  Building and deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --source . \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 1Gi \
    --cpu 1 \
    --timeout 300 \
    --max-instances 3 \
    --set-env-vars="NODE_ENV=production" \
    --set-env-vars="PINECONE_API_KEY=${PINECONE_API_KEY}" \
    --set-env-vars="PINECONE_INDEX_NAME=${PINECONE_INDEX_NAME}" \
    --set-env-vars="PINECONE_NAMESPACE=${PINECONE_NAMESPACE}" \
    --set-env-vars="GEMINI_PROJECT_ID=${GEMINI_PROJECT_ID}" \
    --set-env-vars="GEMINI_LOCATION=${GEMINI_LOCATION}"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')

echo "✅ Deployment complete!"
echo "🌐 Your app is running at: $SERVICE_URL"
echo ""
echo "📝 Demo credentials:"
echo "   Instructor: instructor@demo.com / demo123"
echo "   Director: director@demo.com / demo123"
echo ""
echo "⚠️  Note: This is using SQLite (data resets on restart)"
echo "   For production, use Cloud SQL instead"