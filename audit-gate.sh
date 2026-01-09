#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "=== WhatsHybrid Audit Gate (determinístico) ==="

fail=0

section () {
  echo ""
  echo "## $1"
}

check () {
  local name="$1"
  shift
  if "$@"; then
    echo "✅ $name"
  else
    echo "❌ $name"
    fail=1
  fi
}

section "1) Sintaxe JS (extensão + backend)"
syntax_errors=0
while IFS= read -r f; do
  if ! node --check "$f" >/dev/null 2>&1; then
    echo "❌ syntax: $f"
    syntax_errors=$((syntax_errors+1))
  fi
done < <(find whatshybrid-extension whatshybrid-backend -name "*.js" -type f 2>/dev/null)
if [[ "$syntax_errors" -eq 0 ]]; then
  echo "✅ syntax_errors=0"
else
  echo "❌ syntax_errors=$syntax_errors"
  fail=1
fi

section "2) Segurança: postMessage targetOrigin '*'"
pm_star="$( (grep -R "postMessage.*'\\*'" whatshybrid-extension --include='*.js' 2>/dev/null || true) | wc -l | tr -d ' ')"
if [[ "$pm_star" -eq 0 ]]; then
  echo "✅ postMessage_star=0"
else
  echo "❌ postMessage_star=$pm_star"
  fail=1
fi

section "3) Memory leaks: setInterval órfão (heurística de alta confiança)"
orphan_si="$( ( (grep -R "setInterval(" whatshybrid-extension --include='*.js' 2>/dev/null || true) | grep -v "= setInterval\\|const .*setInterval\\|let .*setInterval\\|clearInterval\\|\\.setInterval" || true ) | wc -l | tr -d ' ')"
if [[ "$orphan_si" -eq 0 ]]; then
  echo "✅ orphan_setInterval=0"
else
  echo "❌ orphan_setInterval=$orphan_si"
  fail=1
fi

section "4) Backend: webhooks.js não deve aplicar assinatura global"
wh_use="$( (grep -R "router\\.use(verifyWebhookSignature" -n whatshybrid-backend/src/routes/webhooks.js 2>/dev/null || true) | wc -l | tr -d ' ')"
if [[ "$wh_use" -eq 0 ]]; then
  echo "✅ webhooks_router_use_verify=0"
else
  echo "❌ webhooks_router_use_verify=$wh_use"
  fail=1
fi

section "5) Backend: webhooks-payment endpoints não-oficiais protegidos"
pg_ok="$( (grep -nF "router.post('/pagseguro', requirePaymentWebhookSecret" whatshybrid-backend/src/routes/webhooks-payment.js 2>/dev/null || true) | wc -l | tr -d ' ')"
pix_ok="$( (grep -nF "router.post('/pix', requirePaymentWebhookSecret" whatshybrid-backend/src/routes/webhooks-payment.js 2>/dev/null || true) | wc -l | tr -d ' ')"
gen_ok="$( (grep -nF "router.post('/generic', requirePaymentWebhookSecret" whatshybrid-backend/src/routes/webhooks-payment.js 2>/dev/null || true) | wc -l | tr -d ' ')"
if [[ "$pg_ok" -ge 1 && "$pix_ok" -ge 1 && "$gen_ok" -ge 1 ]]; then
  echo "✅ payment_webhooks_protected=1"
else
  echo "❌ payment_webhooks_protected=0 (pagseguro=$pg_ok pix=$pix_ok generic=$gen_ok)"
  fail=1
fi

echo ""
if [[ "$fail" -eq 0 ]]; then
  echo "=== RESULTADO: PASS ✅ ==="
  exit 0
fi

echo "=== RESULTADO: FAIL ❌ ==="
exit 1

