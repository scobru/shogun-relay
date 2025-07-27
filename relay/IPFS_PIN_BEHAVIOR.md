# IPFS Pin Behavior

## Why are 3 pins created when you upload to IPFS?

The behavior you observe is **normal** for IPFS. Here's what happens:

### 1. **IPFS Data Structure**
When you upload a file to IPFS, the system automatically creates a hierarchical structure:

- **Original file** → File CID
- **Directory wrapper** → Directory CID that contains the file
- **Metadata** → File metadata CID

### 2. **Recursive Pin**
IPFS uses **recursive pinning** by default, which means that when you pin an object, all related blocks are automatically pinned.

### 3. **Current Configuration**
In your current code you're using:
```javascript
path: "/api/v0/add?wrap-with-directory=false"
```

This parameter should disable the automatic creation of the directory wrapper, but IPFS might still create multiple pins.

## Solutions to reduce pins

### Option 1: Disable automatic pinning
Add the `pin=false` parameter to upload endpoints:

```javascript
path: "/api/v0/add?wrap-with-directory=false&pin=false"
```

### Option 2: Selective manual pinning
After upload, manually pin only the main file:

```javascript
// After upload, pin only the main file
const pinResult = await fetch('/pins/add', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ cid: fileResult.Hash })
});
```

### Option 3: IPFS Configuration
Modify IPFS configuration to reduce automatic pinning behavior:

```bash
ipfs config --json Pinning.Recursive false
```

## Normal vs Abnormal Behavior

### ✅ **Normal behavior:**
- 2-3 pins per file (file + metadata + directory)
- Automatic recursive pinning
- IPFS hierarchical structure

### ❌ **Abnormal behavior:**
- More than 5 pins for a simple file
- Duplicate pins of the same CID
- Pins of unrelated objects

## Verification and Monitoring

### Check current pins:
```bash
curl -X POST "http://localhost:5001/api/v0/pin/ls"
```

### Analyze structure:
```bash
curl -X POST "http://localhost:5001/api/v0/ls?arg=<CID>"
```

## Recommendations

1. **For normal use**: Current behavior is correct
2. **To save space**: Use `pin=false` and pin manually
3. **For debugging**: Check IPFS logs for pin details

## Technical Notes

- IPFS uses DAG (Directed Acyclic Graph) to structure data
- Each DAG node can be pinned separately
- Recursive pinning is the default strategy to ensure persistence
- Multiple pins are necessary for network robustness 