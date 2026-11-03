// Collectors: who collects from each client, the payments collectors
// recorded that wait for an admin's confirmation, and the bell with each
// person's messages (convex/lib/team.ts, convex/messages.ts).

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { describeError } from "../lib/errors";
import type { Fmt } from "../lib/format";
import { useT, type T } from "../lib/i18n";
import { ReceiptSheet } from "../receipts/view";
import { useBooks } from "../state/app";
import type { Snapshot } from "../state/types";
import { Icon } from "../ui/icons";
import { Avatar, Banner, Button, Card, Empty, Field, LinkButton, Pill, Row, Sheet, useToast } from "../ui/kit";
import { usePresence } from "../ui/motion";

type Pending = Snapshot["pending"][number];

/** The people who can be given clients, and how to name them. Without any
 *  collector in the business every client is the admins' own. */
export function useTeam() {
  const t = useT();
  const { snapshot, user } = useBooks();
  return useMemo(() => {
    const people = snapshot.people.filter((p) => p.active);
    const collectors = people.filter((p) => p.role === "collector");
    const takers = people.filter((p) => p.role === "collector" || p.role === "admin");
    const nameOf = (userId: string | undefined) => {
      if (!userId) return t("No collector", "Sin cobrador");
      if (userId === user?.id) return t("You", "Tú");
      return snapshot.people.find((p) => p.userId === userId)?.name ?? t("No collector", "Sin cobrador");
    };
    return {
      collectors,
      takers,
      hasCollectors: collectors.length > 0,
      nameOf,
      me: user?.id,
    };
  }, [snapshot.people, user?.id, t]);
}

/** A collector picker; "" means nobody. */
export function CollectorSelect({ value, onChange, id, label }: { value: string; onChange: (v: string) => void; id?: string; label?: string }) {
  const t = useT();
  const team = useTeam();
  return (
    <select id={id} className="input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("No collector", "Sin cobrador")}</option>
      {team.takers.map((p) => (
        <option key={p.userId} value={p.userId}>
          {p.userId === team.me ? t("You (admin)", "Tú (administrador)") : p.role === "admin" ? `${p.name} (${t("admin", "administrador")})` : p.name}
        </option>
      ))}
    </select>
  );
}

// ----- the bell ---------------------------------------------------------------

export function useMessages(): Doc<"messages">[] {
  const { mode, businessId } = useBooks();
  return useQuery(api.messages.mine, mode === "online" && businessId ? { businessId } : "skip") ?? [];
}

function names(t: T, list: string[]): string {
  if (list.length <= 3) return list.join(", ");
  const more = list.length - 3;
  return `${list.slice(0, 3).join(", ")} ${t(`and ${more} more`, `y ${more} más`)}`;
}

export function messageText(t: T, fmt: Fmt, m: Doc<"messages">): string {
  const who = names(t, m.clientNames);
  const money = m.amount !== undefined ? fmt.money(m.amount) : "";
  switch (m.kind) {
    case "due_unassigned":
      return t(
        `${who} pays ${money} on ${m.dueOn ? fmt.dayShort(m.dueOn) : ""} and has no collector.`,
        `${who} paga ${money} el ${m.dueOn ? fmt.dayShort(m.dueOn) : ""} y no tiene cobrador.`,
      );
    case "assigned":
      return m.clientNames.length === 1
        ? t(`You were given a client: ${who}.`, `Te asignaron un cliente: ${who}.`)
        : t(`You were given ${m.clientNames.length} clients: ${who}.`, `Te asignaron ${m.clientNames.length} clientes: ${who}.`);
    case "unassigned":
      return t(`No longer your clients: ${who}.`, `Ya no son tus clientes: ${who}.`);
    case "collected":
      return t(
        `${m.fromName} collected ${money} from ${who}. It counts once you confirm it.`,
        `${m.fromName} cobró ${money} a ${who}. Cuenta cuando lo confirmes.`,
      );
    case "confirmed":
      return t(`Your ${money} from ${who} was confirmed.`, `Se confirmó tu cobro de ${money} a ${who}.`);
    case "rejected":
      return t(`Your ${money} from ${who} was rejected: “${m.reason ?? ""}”`, `Se rechazó tu cobro de ${money} a ${who}: «${m.reason ?? ""}»`);
  }
}

/** The bell button, with the number of new messages; opens them. */
export function MessagesButton() {
  const t = useT();
  const messages = useMessages();
  const [open, setOpen] = useState(false);
  const unread = messages.filter((m) => m.readAt === undefined).length;
  // One more unread than before: the bell swings and its count pops.
  const [ring, setRing] = useState(false);
  const seen = useRef(unread);
  useEffect(() => {
    const more = unread > seen.current;
    seen.current = unread;
    if (!more) return;
    setRing(true);
    const timer = setTimeout(() => setRing(false), 800);
    return () => clearTimeout(timer);
  }, [unread]);
  return (
    <>
      <button
        type="button"
        className={`btn icon small bell ${ring ? "ring" : ""}`}
        aria-label={t(`Messages, ${unread} new`, `Mensajes, ${unread} nuevos`)}
        onClick={() => setOpen(true)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && <MessagesSheet messages={messages} onClose={() => setOpen(false)} />}
    </>
  );
}

function MessagesSheet({ messages, onClose }: { messages: Doc<"messages">[]; onClose: () => void }) {
  const t = useT();
  const { fmt, businessId, can, snapshot } = useBooks();
  const navigate = useNavigate();
  // A collected payment someone already decided needs nothing more.
  const stillWaiting = (m: Doc<"messages">) => snapshot.pending.some((p) => p._id === m.pendingId && p.status === "waiting");
  const markRead = useMutation(api.messages.markRead);
  // New ones stay marked as new while the sheet is open.
  const [fresh] = useState(() => new Set(messages.filter((m) => m.readAt === undefined).map((m) => m._id)));
  useEffect(() => {
    if (fresh.size > 0 && businessId) void markRead({ businessId }).catch(() => {});
  }, [fresh, businessId, markRead]);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const when = (ms: number) =>
    new Date(ms).toLocaleString(fmt.lang === "es" ? "es" : "en", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <Sheet title={t("Messages", "Mensajes")} onClose={onClose}>
      {messages.length === 0 ? (
        <Empty icon="bell">{t("No messages.", "No hay mensajes.")}</Empty>
      ) : (
        <ul className="list messages">
          {messages.map((m) => (
            <li key={m._id} className={fresh.has(m._id) ? "fresh" : ""}>
              <div className="list-row">
                <span className={`msg-ico ${m.kind}`} aria-hidden="true">
                  <Icon
                    name={
                      m.kind === "due_unassigned"
                        ? "clock"
                        : m.kind === "collected"
                          ? "wallet"
                          : m.kind === "rejected"
                            ? "close"
                            : m.kind === "confirmed"
                              ? "check"
                              : "users"
                    }
                  />
                </span>
                <div className="grow">
                  <div className="title wrap">{messageText(t, fmt, m)}</div>
                  <div className="sub">{when(m.createdAt)}</div>
                  {m.kind === "due_unassigned" && can("manage") && (
                    <Button size="small" variant="primary" onClick={() => go("/clients?collector=none")}>
                      {t("Assign a collector", "Asignar cobrador")}
                    </Button>
                  )}
                  {m.kind === "collected" && can("manage") && stillWaiting(m) && (
                    <Button size="small" onClick={() => go("/confirm")}>
                      {t("Review and confirm", "Revisar y confirmar")}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ----- payments waiting for confirmation ---------------------------------------

export function pendingStatus(t: T, p: Pending): { tone: "warn" | "pos" | "neg"; label: string } {
  if (p.status === "confirmed") return { tone: "pos", label: t("Confirmed", "Confirmado") };
  if (p.status === "rejected") return { tone: "neg", label: t("Rejected", "Rechazado") };
  return {
    tone: "warn",
    label: t("Waiting for confirmation", "Esperando confirmación"),
  };
}

export function ConfirmScreen() {
  const t = useT();
  const { snapshot, books, fmt, businessId, can, mode } = useBooks();
  const team = useTeam();
  const toast = useToast();
  const confirm = useMutation(api.payments.confirm);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const decide = can("manage") && mode === "online";
  const waitingNow = snapshot.pending.filter((p) => p.status === "waiting").sort((a, b) => a.createdAt - b.createdAt);
  // A payment just confirmed or rejected stays a moment to slide away.
  const present = usePresence(waitingNow, (p) => p._id);
  const leavingIds = new Set(present.filter((x) => x.leaving).map((x) => x.item._id));
  const waiting = present.map((x) => x.item);
  const decided = snapshot.pending.filter((p) => p.status !== "waiting").sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  const groups = [...new Set(waiting.map((p) => p.collectedBy))].map((who) => ({
    who,
    items: waiting.filter((p) => p.collectedBy === who),
  }));
  const total = waitingNow.reduce((a, p) => a + p.amount, 0);
  const clientName = (p: Pending) => books.clientById.get(p.clientId)?.client.fullName ?? "—";
  const loanNo = (p: Pending) => books.loanById.get(p.loanId)?.loan.recordNo;

  const confirmMany = async (items: Pending[]) => {
    let done = 0;
    for (const p of items) {
      setBusy(p._id);
      try {
        await confirm({
          businessId,
          pendingId: p._id as Id<"pendingPayments">,
        });
        done += 1;
      } catch (e) {
        toast(`${clientName(p)}: ${describeError(t, fmt, e)}`);
        break;
      }
    }
    setBusy(null);
    if (done > 0) toast(done === 1 ? t("Payment confirmed.", "Pago confirmado.") : t(`${done} payments confirmed.`, `${done} pagos confirmados.`));
  };

  const row = (p: Pending, actions: boolean) => {
    const st = pendingStatus(t, p);
    const leaving = actions && leavingIds.has(p._id);
    return (
      <li key={p._id} className={leaving ? "leaving" : undefined} aria-hidden={leaving || undefined}>
        <div className="list-row">
          <Avatar name={clientName(p)} />
          <div className="grow">
            <div className="title">{clientName(p)}</div>
            <div className="sub">
              {[
                loanNo(p) !== undefined ? t(`Loan #${loanNo(p)}`, `Préstamo #${loanNo(p)}`) : "",
                fmt.day(p.paidOn),
                p.status === "rejected" ? `“${p.reason}”` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="trail">
            <span className="amount num">{fmt.money(p.amount)}</span>
            {actions ? (
              <span className="row" style={{ gap: 6 }}>
                <Button size="small" variant="ghost" icon="printer" aria-label={t("Receipt", "Recibo")} onClick={() => setReceipt(p._id)} />
                <Button size="small" variant="ghost" onClick={() => setRejecting(p)} disabled={busy !== null}>
                  {t("Reject", "Rechazar")}
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  loading={busy === p._id}
                  disabled={busy !== null && busy !== p._id}
                  onClick={() => void confirmMany([p])}
                >
                  {t("Confirm", "Confirmar")}
                </Button>
              </span>
            ) : (
              <Pill tone={st.tone}>{st.label}</Pill>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div>
      <div className="topbar">
        <div className="grow">
          <h1>{t("Payments to confirm", "Pagos por confirmar")}</h1>
          <div className="small muted">
            {waitingNow.length === 0
              ? t("Nothing waiting.", "Nada pendiente.")
              : t(`${fmt.money(total)} in ${waitingNow.length} payment(s)`, `${fmt.money(total)} en ${waitingNow.length} pago(s)`)}
          </div>
        </div>
      </div>
      <Banner tone="info" icon="info">
        {t(
          "A collector's payment doesn't count until you confirm the money reached you: the balance, overdue and totals stay as they were. Once confirmed it counts from the day it was collected, so the client isn't charged late fees for the wait. Rejected, it is removed and the collector is told why.",
          "El pago de un cobrador no cuenta hasta que confirmes que el dinero te llegó: el saldo, el atraso y los totales quedan igual. Al confirmarlo cuenta desde el día en que se cobró, así que al cliente no se le cobra mora por la espera. Si lo rechazas, se quita y el cobrador sabe por qué.",
        )}
      </Banner>
      {groups.length === 0 && (
        <Card className="section">
          <Empty icon="check">{t("No payments waiting for confirmation.", "No hay pagos esperando confirmación.")}</Empty>
        </Card>
      )}
      {groups.map((g) => {
        // Payments sliding away are already decided: not counted, not confirmed again.
        const open = g.items.filter((p) => !leavingIds.has(p._id));
        const sum = open.reduce((a, p) => a + p.amount, 0);
        return (
          <Card
            key={g.who}
            className="section"
            title={
              <span>
                {team.nameOf(g.who)} <span className="muted small">· {t(`holds ${fmt.money(sum)}`, `tiene ${fmt.money(sum)}`)}</span>
              </span>
            }
            action={
              decide && open.length > 1 ? (
                <Button size="small" variant="primary" disabled={busy !== null} onClick={() => void confirmMany(open)}>
                  {t(`Confirm all ${open.length}`, `Confirmar los ${open.length}`)}
                </Button>
              ) : null
            }
          >
            <ul className="list">{g.items.map((p) => row(p, decide))}</ul>
          </Card>
        );
      })}
      {decided.length > 0 && (
        <Card className="section" title={t("Decided in the last 30 days", "Decididos en los últimos 30 días")}>
          <ul className="list">{decided.map((p) => row(p, false))}</ul>
        </Card>
      )}
      {rejecting && <RejectSheet pending={rejecting} name={clientName(rejecting)} onClose={() => setRejecting(null)} />}
      {receipt && <ReceiptSheet kind="pending" id={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function RejectSheet({ pending, name, onClose }: { pending: Pending; name: string; onClose: () => void }) {
  const t = useT();
  const { fmt, businessId } = useBooks();
  const toast = useToast();
  const reject = useMutation(api.payments.reject);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!reason.trim()) return setError(t("Say why, for the collector.", "Di por qué, para el cobrador."));
    setBusy(true);
    try {
      await reject({
        businessId,
        pendingId: pending._id as Id<"pendingPayments">,
        reason,
      });
      toast(t("Payment rejected.", "Pago rechazado."));
      onClose();
    } catch (e) {
      setError(describeError(t, fmt, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={t("Reject this payment?", "¿Rechazar este pago?")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="danger" loading={busy} onClick={() => void save()}>
            {t("Reject", "Rechazar")}
          </Button>
        </>
      }
    >
      <p>
        {t(
          `${fmt.money(pending.amount)} from ${name}, collected by ${pending.collectorName}. It never counted, so nothing else changes.`,
          `${fmt.money(pending.amount)} de ${name}, cobrado por ${pending.collectorName}. Nunca contó, así que nada más cambia.`,
        )}
      </p>
      <Field label={t("Why (the collector sees this)", "Por qué (el cobrador lo ve)")} error={error}>
        {(id) => (
          <input
            id={id}
            className="input"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("Recorded twice", "Registrado dos veces")}
          />
        )}
      </Field>
    </Sheet>
  );
}

/** A loan's collected payments still waiting for an admin. */
export function PendingOnLoan({ loanId }: { loanId: string }) {
  const t = useT();
  const { snapshot, fmt, can } = useBooks();
  const [receipt, setReceipt] = useState<string | null>(null);
  const rows = snapshot.pending.filter((p) => p.loanId === loanId && p.status === "waiting");
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((p) => (
        <Row
          key={p._id}
          title={
            <>
              {fmt.money(p.amount)} <span className="muted small">· {fmt.day(p.paidOn)}</span>
            </>
          }
          sub={t(`Collected by ${p.collectorName} · doesn't count until confirmed`, `Cobrado por ${p.collectorName} · no cuenta hasta confirmarlo`)}
          trail={
            <>
              <Pill tone="warn">{t("To confirm", "Por confirmar")}</Pill>
              <Button size="small" variant="ghost" icon="printer" aria-label={t("Receipt", "Recibo")} onClick={() => setReceipt(p._id)} />
              {can("manage") && (
                <LinkButton to="/confirm" size="small" variant="ghost">
                  {t("Review", "Revisar")}
                </LinkButton>
              )}
            </>
          }
        />
      ))}
      {receipt && <ReceiptSheet kind="pending" id={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

/** Assign several clients at once. */
export function AssignSheet({ clients, onClose }: { clients: { _id: string; fullName: string; collectorId?: string }[]; onClose: () => void }) {
  const t = useT();
  const { fmt, businessId } = useBooks();
  const team = useTeam();
  const toast = useToast();
  const assign = useMutation(api.clients.assign);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [to, setTo] = useState(team.collectors[0]?.userId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const save = async () => {
    if (picked.size === 0) return setError(t("Choose at least one client.", "Elige al menos un cliente."));
    setBusy(true);
    try {
      await assign({
        businessId,
        clientIds: [...picked] as Id<"clients">[],
        collectorId: to || null,
      });
      toast(
        t(`${picked.size} client(s) given to ${team.nameOf(to || undefined)}.`, `${picked.size} cliente(s) asignado(s) a ${team.nameOf(to || undefined)}.`),
      );
      onClose();
    } catch (e) {
      setError(describeError(t, fmt, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      wide
      title={t("Assign clients", "Asignar clientes")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {picked.size > 0 ? t(`Assign ${picked.size}`, `Asignar ${picked.size}`) : t("Assign", "Asignar")}
          </Button>
        </>
      }
    >
      <Field label={t("Give them to", "Asignar a")} error={error}>
        {(id) => <CollectorSelect id={id} value={to} onChange={setTo} />}
      </Field>
      <p className="small muted">
        {t(
          "Each client goes with all their loans. A collector sees only the clients assigned to them.",
          "Cada cliente va con todos sus préstamos. Un cobrador solo ve los clientes asignados a él.",
        )}
      </p>
      <ul className="list assign-list">
        {clients.map((c) => (
          <li key={c._id}>
            <label className="list-row">
              <input type="checkbox" checked={picked.has(c._id)} onChange={() => toggle(c._id)} />
              <div className="grow">
                <div className="title">{c.fullName}</div>
                <div className="sub">{team.nameOf(c.collectorId)}</div>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
