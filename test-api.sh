#!/bin/bash

echo "=== Testing Forge API ==="
echo ""

# Test 1: Backend health
echo "1. Testing Backend /health..."
curl -s http://localhost:4000/health | jq '.'
echo ""

# Test 2: Orchestrator health  
echo "2. Testing Orchestrator /health..."
curl -s http://localhost:5001/health | jq '.'
echo ""

# Test 3: User registration
echo "3. Testing User Registration..."
REGISTER_RESPONSE=$(curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@forge.local",
    "password": "SecurePass123!"
  }')
echo "$REGISTER_RESPONSE" | jq '.'
TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.token')
echo "Token: ${TOKEN:0:20}..."
echo ""

# Test 4: Get user info
echo "4. Testing /api/auth/me..."
curl -s http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 5: List workspace images
echo "5. Testing /api/workspaces/images..."
curl -s http://localhost:4000/api/workspaces/images \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo ""

# Test 6: Invalid email (should fail)
echo "6. Testing Input Validation - Invalid Email..."
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bad Email",
    "email": "notanemail",
    "password": "SecurePass123!"
  }' | jq '.'
echo ""

# Test 7: Weak password (should fail)
echo "7. Testing Input Validation - Weak Password..."
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weak Pass",
    "email": "weak@forge.local",
    "password": "weak"
  }' | jq '.'
echo ""

# Test 8: Invalid repoUrl (should fail on workspace create)
echo "8. Testing Input Validation - Invalid Repo URL..."
curl -s -X POST http://localhost:4000/api/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-workspace",
    "image": "cloud-dev-base:latest",
    "repoUrl": "invalid://url"
  }' | jq '.'
echo ""

echo "=== All Tests Complete ==="
