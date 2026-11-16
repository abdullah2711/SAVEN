#!/bin/bash
# Boots the Herdr panes for the factory.
# SAFETY: herdr subcommand names vary by version — this script verifies the
# CLI first and tells the operator what to substitute if the suggested
# commands differ. The verified SAVEN fallback (pane run launches) is echoed.
echo "== herdr version/subcommands:"
herdr --help 2>&1 | head -30
echo
echo "== Attempting owner-suggested boot commands (may need substitution for your herdr version):"
herdr new saven 2>&1 || echo "NOTE: 'herdr new' not supported by this herdr version — create the session with your version's create subcommand."
herdr pane split 1-1 --direction right 2>&1 || echo "NOTE: 'herdr pane split' not supported — use your version's pane create/split subcommand."
herdr pane split 1-1 --direction down 2>&1 || true
echo
echo "== Verified SAVEN fallback (this is how the production factory boots agents):"
echo "   Map panes in ~/.config/herdr/saven-panes.env as:"
echo "     DISPATCHER=w1:p1"
echo "     WORKER_A=w1:p2"
echo "     WORKER_B=w1:p3"
echo "     ENGINEER=w1:p4"
echo "   Then launch per pane with: herdr pane run <pane-id> '<launch command>'"
echo "     Dispatcher: opencode mini --agent dispatcher --model <dispatcher-model>"
echo "     Workers:    opencode mini --agent build --model <worker-model>"
echo "     Engineer:   opencode"
echo "Herdr panes created or instructions printed. Waiting for bootstrap prompts."
