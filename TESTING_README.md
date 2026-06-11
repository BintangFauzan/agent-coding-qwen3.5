# Testing Documentation Summary

Lengkap testing documentation untuk Smart Intent Detection di Gemma Agent.

---

## 📋 Files Created

### 1. **TESTING_PROMPTS.md** (Comprehensive)
- 8 detailed test scenarios
- Expected behaviors untuk masing-masing
- Success criteria jelas
- Metrics to track
- Debugging guide

**Use when:** Anda butuh pemahaman mendalam tentang test apa dan kenapa

---

### 2. **QUICK_TESTS.md** (Quick Reference)
- Copy-paste ready prompts
- One-liner expected results
- Failure signs checklist
- Expected results table
- Quick validation commands

**Use when:** Anda ingin quick testing tanpa baca panjang

---

### 3. **run-tests.bat** (Windows Batch)
- Interactive testing script
- Walks through each test
- Collects PASS/FAIL results
- Shows summary

**Use when:** Running di Windows CMD

```bash
cd ai_coding_agent
.\run-tests.bat
```

---

### 4. **run-tests.ps1** (PowerShell)
- Interactive testing script
- Color-coded output
- Same as batch tapi dengan PowerShell features

**Use when:** Using Windows PowerShell

```powershell
cd ai_coding_agent
.\run-tests.ps1
```

---

## 🎯 Quick Start

### Option A: Manual Testing (Fastest)
```bash
cd gemma-agent
npm run dev -- -w "C:\wamp64\www\Perpustakaan"
```

Then copy-paste prompts dari **QUICK_TESTS.md**

---

### Option B: Guided Testing
```bash
cd ai_coding_agent
.\run-tests.bat          # Windows CMD
# atau
.\run-tests.ps1          # PowerShell
```

---

### Option C: Deep Dive Testing
1. Baca **TESTING_PROMPTS.md** 
2. Understand setiap test scenario
3. Run tests manually dengan agent
4. Track metrics
5. Debug failures dengan guide

---

## ✅ 8 Test Scenarios

| # | Name | Type | Intent | Result |
|---|------|------|--------|--------|
| 1 | Analyze Only | Analysis | "analisa projek ini" | STOP after findings |
| 2 | Analyze + Fix | Two phases | "review..." then "fix..." | Analyze → then implement |
| 3 | Direct Fix | Implementation | "fix ini error" | Auto-detect, no analyze phase |
| 4 | Override | Analysis | "...jangan diedit" | Force analyze-only |
| 5 | Refactor | Implementation | "refactor ini" | Full implementation |
| 6 | Multi-Step | Implementation | Complex request | Proper todo tracking |
| 7 | Error Recovery | Implementation | Error handling | Retry + searchWeb |
| 8 | Ambiguous | Analysis | Unclear request | Default to analyze-only |

---

## 🔍 Key Metrics to Monitor

### For ANALYZE-ONLY Tests (1, 2a, 4, 8):
```
✅ Iterations: 1
✅ Tool calls: listFiles + readFile (2-4 total)
✅ Todo items: 0 (no todos for analyze)
✅ Edits: 0 (no writeFile/editFile)
✅ Output: Analysis findings (500-1000 words)
```

### For IMPLEMENT Tests (2b, 3, 5, 6, 7):
```
✅ Iterations: 3-6 (depending on complexity)
✅ Tool calls: 6-10 (read, write, run commands)
✅ Todo items: 2-4 (stable count, not growing)
✅ Edits: 1-3 files modified
✅ Output: Todo tracking + implementation status
```

---

## ❌ Failure Signs (STOP & DEBUG)

```
❌ Iterations > 10                    → Infinite loop
❌ Todo items: 4 → 8 → 12 → 16...     → Snowball effect
❌ Same error repeated 3+ times      → Recovery stuck
❌ listFiles called every iteration   → Looping
❌ Analyze mode editing files         → Intent detection failed
❌ Model keeps thinking infinitely    → Context window issue
```

---

## 🛠️ Debugging Failed Tests

### Checklist:
```
[ ] Is Ollama running? (ollama serve)
[ ] Model loaded? (ollama list | grep gemma4-coding)
[ ] Workspace path correct?
[ ] Check agent.ts line 302 - parseTodo() strict?
[ ] Check line 430 - detectIntent() working?
[ ] Check line 550 - early exit logic?
```

### Debug Commands:
```bash
# Check if loop happening
tail -f console.log | grep "iterasi"

# Check git changes
git status

# See file modifications
git diff --name-only

# Check model response
npm run dev -- -w "..." 2>&1 | tee test-output.log
```

---

## 📊 Expected Results Summary

### Test 1 Output Example:
```
❯ analisa projek ini

[listFiles called]
./ contains 5 folders

[readFile called - connection.php]
[readFile called - LoginPage.php]
[readFile called - HalamanUtama.php]

**Analysis:**
1. Project is a PHP web app with:
   - Database connection in config/
   - Login/registration UI in public/
   - Main page after auth

2. Issues found:
   - No password hashing (potential security risk)
   - SQL queries not using prepared statements
   - No input validation on login form

3. Recommendations:
   - Implement bcrypt for passwords
   - Use prepared statements
   - Add form validation

---
✅ Analysis complete. Would you like me to fix these issues?
```

**Key:** No edits, clear findings, waiting for next input

---

### Test 3 Output Example:
```
❯ buat API endpoint untuk list users

<todo>
[ ] Create src/api/users.ts
[ ] Add GET /api/users handler
[ ] Test with runCommand
</todo>

[Reading project structure...]
[Creating src/api/users.ts...]
✓ writeFile — Created src/api/users.ts

[•] Step 1: Create src/api/users.ts
[x] Step 1: Done

[ ] Step 2: Add GET /api/users handler
[Adding handler...]
✓ editFile — Modified src/api/users.ts

[x] Step 2: Done

[ ] Step 3: Test with runCommand
[Running tests...]
✓ runCommand — Tests passed

[x] Step 3: Done

---
✅ API endpoint created and tested!
```

**Key:** Todos tracked, iterations clear, all verified

---

## 🚀 Next Steps After Testing

✅ **If all tests pass:**
1. Deploy to production
2. Document user-facing features
3. Monitor performance metrics

❌ **If tests fail:**
1. Use debugging guide above
2. Check agent.ts changes applied correctly
3. Run `npm run build` to recompile
4. Re-test with same prompt

---

## Contact Points for Issues

If tests still fail:
1. **parseTodo() issues** → Check line 302 in agent.ts
2. **Intent detection issues** → Check line 430 (detectIntent function)
3. **Early exit not working** → Check line 550 in reactLoop
4. **Looping happening** → Enable debug logs and trace history

---

**Status:** ✅ Ready to test!

Start with **QUICK_TESTS.md** or run `.\run-tests.ps1`
