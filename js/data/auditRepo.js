/* data/auditRepo.js — Lectura de auditoría (la escritura vive en base.js) */

import { db, collection, getDocs, query, where, orderBy, limit, listData } from "./base.js";
import { COLLECTIONS } from "../core/constants.js";

export async function listAuditLogs({ entidad, entidadId, max = 100 } = {}) {
  const col = collection(db, COLLECTIONS.auditLogs);
  let q = query(col, orderBy("createdAt", "desc"), limit(max));
  if (entidad && entidadId) {
    q = query(col, where("entidad", "==", entidad), where("entidadId", "==", entidadId), limit(max));
  }
  const qs = await getDocs(q);
  return listData(qs);
}
