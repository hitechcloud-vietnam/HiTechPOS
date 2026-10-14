#!/bin/sh
# Generates /etc/hitechpos/{shard,control-plane}.env with fresh secrets.
# TENANT_SECRET_KEY unseals every shop's secrets: back it up offline; losing
# it means losing every shop's keys. Never re-run over existing files.
set -eu
DIR=/etc/hitechpos
[ -e "$DIR/shard.env" ] && { echo "$DIR/shard.env exists - refusing to overwrite" >&2; exit 1; }
umask 077
mkdir -p "$DIR"
hex() { node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }
TENANT_SECRET_KEY=$(hex 32)
POSNIC_KEY=$(hex 16)
POSNIC_SECRET=$(hex 32)
MONGO=${MONGO_URI:-mongodb://127.0.0.1:27017/?replicaSet=rs0}
cat > "$DIR/shard.env" <<ENV
CONTROL_URI=$MONGO
MONGODB_URI=$MONGO
CONTROL_DB=hitechpos_control
TENANT_SECRET_KEY=$TENANT_SECRET_KEY
SHOP_BASE_DOMAINS=hitechpos.vn
POSNIC_KEY=$POSNIC_KEY
POSNIC_SECRET=$POSNIC_SECRET
HITECH_PAY_URL=http://127.0.0.1:4100
SESSION_SECRET=$(hex 32)
ENV
cat > "$DIR/control-plane.env" <<ENV
PUBLIC_URL=https://app.hitechpos.vn
CONTROL_URI=$MONGO
CONTROL_DB=hitechpos_control
TENANT_SECRET_KEY=$TENANT_SECRET_KEY
SESSION_SECRET=$(hex 32)
ADMIN_API_KEY=$(hex 24)
SHOP_BASE_DOMAINS=hitechpos.vn
POSNIC_KEY=$POSNIC_KEY
POSNIC_SECRET=$POSNIC_SECRET
SAAS_VAT_RATE=KCT
# PAYOS_CLIENT_ID= PAYOS_API_KEY= PAYOS_CHECKSUM_KEY=
# PAY2S_ENV=production PAY2S_ACCESS_KEY= PAY2S_PARTNER_CODE= PAY2S_SECRET_KEY=
ENV
echo "Written $DIR/shard.env and $DIR/control-plane.env (mode 0600)."
echo "ADMIN_API_KEY is in control-plane.env; back up TENANT_SECRET_KEY offline now."
