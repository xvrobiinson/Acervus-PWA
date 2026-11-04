// The change history: every create, edit and deletion, who made it and
// what changed, in plain words (src/lib/history-text.ts). Read from the
// server a page at a time (online only).

import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { describeChange, describeFeeGroup, foldLateFees, type HistoryNames } from "../lib/history-text";
import { useT } from "../lib/i18n";
import { useBooks } from "../state/app";
import { AcervusLoader, Banner, Button, Card, Empty, Pill } from "../ui/kit";

export function HistoryScreen() {
  const t = useT();
  const { businessId, fmt, mode, books } = useBooks();
  const members = useQuery(api.businesses.members, mode === "online" ? { businessId } : "skip");
  const names: HistoryNames = {
    client: (id) => books.clientById.get(id)?.client.fullName,
    member: (id) => members?.find((m) => m._id === id)?.name,
    loan: (id) => {
      const l = books.loanById.get(id)?.loan;
      return l ? { recordNo: l.recordNo, clientId: l.clientId } : undefined;
    },
  };
  const { results, status, loadMore } = usePaginatedQuery(api.data.changes, mode === "online" ? { businessId } : "skip", { initialNumItems: 40 });
  const action: Record<string, [string, "pos" | "warn" | "neg"]> = {
    create: [t("Created", "Creado"), "pos"],
    update: [t("Changed", "Cambiado"), "warn"],
    delete: [t("Deleted", "Eliminado"), "neg"],
  };
  return (
    <div>
      <div className="topbar">
        <h1>{t("History", "Historial")}</h1>
      </div>
      {mode !== "online" && <Banner tone="offline" icon="cloudOff">{t("The history needs a connection.", "El historial necesita conexión.")}</Banner>}
      <Card>
        <ul className="list">
          {foldLateFees(results).map((item) => {
            const c = Array.isArray(item) ? item[0] : item;
            const d = Array.isArray(item) ? describeFeeGroup(item, t, fmt, names) : describeChange(c, t, fmt, names);
            // A folded group of late fees reads as one change.
            const act = Array.isArray(item) ? "update" : c.action;
            return (
              <li key={c._id}>
                <div className="list-row hist-row">
                  <div className="grow">
                    <div className="row wrap" style={{ gap: 8 }}>
                      <Pill tone={action[act][1]}>{action[act][0]}</Pill>
                      <span className="strong">{d.subject}</span>
                    </div>
                    <div className="micro faint hist-when">
                      {new Date(c.createdAt).toLocaleString(fmt.lang, { dateStyle: "medium", timeStyle: "short" })} · {c.userName}
                    </div>
                    {d.lines.length > 0 && (
                      <dl className="hist-lines small">
                        {d.lines.map((l, i) => (
                          <div key={i}>
                            <dt>{l.label}</dt>
                            <dd>
                              {l.to !== undefined ? (
                                <>
                                  <span className="hist-old">{l.from}</span>
                                  <span className="hist-arrow" aria-label={t("changed to", "cambió a")}>→</span>
                                  <span className="strong">{l.to}</span>
                                </>
                              ) : (
                                l.value
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {d.reason && <div className="small hist-reason">“{d.reason}”</div>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {status === "LoadingFirstPage" && mode === "online" && <div className="loading-block"><AcervusLoader size="small" label={t("Loading the history…", "Cargando el historial…")} /></div>}
        {results.length === 0 && status !== "LoadingFirstPage" && <Empty icon="history">{t("No changes yet.", "Aún no hay cambios.")}</Empty>}
      </Card>
      {status === "CanLoadMore" && (
        <div style={{ marginTop: 12 }}>
          <Button block onClick={() => loadMore(40)}>{t("Load more", "Cargar más")}</Button>
        </div>
      )}
    </div>
  );
}
