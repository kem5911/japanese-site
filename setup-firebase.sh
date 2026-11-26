#!/bin/bash
# 한 번만 실행: GitHub Actions가 비밀키 없이 hanil-densha.web.app에 배포하도록 권한 연결
P=hanil-app
N=839137693619
SA=github-deploy@$P.iam.gserviceaccount.com
REPO=kem5911/japanese-site
gcloud config set project $P
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com cloudresourcemanager.googleapis.com
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || gcloud iam service-accounts create github-deploy --display-name="GitHub 자동 배포"
for r in roles/firebasehosting.admin roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role=$r --condition=None -q >/dev/null && echo "ok $r"
done
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe japanese-site --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
gcloud iam workload-identity-pools providers create-oidc japanese-site --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'"
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" -q >/dev/null && echo "ok wif binding"
echo "=== DONE ==="
