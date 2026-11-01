import type { Doc } from "../core.js";
// Shared domain operations. Both SQLite and PostgreSQL execute this same workflow.
import { randomUUID, createHash } from "node:crypto";
import { writeFileSync, readFileSync, linkSync, unlinkSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import multer from 'multer';
import { z } from "zod";
import { type Row } from "../../db.js";
import { PhotoStorage, MAX_PHOTO_BYTES } from "../../photos.js";
import { id, now, allow, fail, mutate, type User } from "../core.js";
import { task, authorizeForeman } from "./tasks.js";
import { uploadFields, multipart, uploadDto } from "../uploads.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../flow.js";

export function* uploadActor(s: FlowContext, a: User, taskId: string): Flow<Doc> { allow(a, 'worker', 'foreman'); const t = (yield* task(s, a, taskId)); if (a.role === 'foreman')
    (yield* authorizeForeman(s, a, t)); return t; }

export function* validatePhotos(s: FlowContext, a: User, taskId: string, photoIds: string[], allowedOwners: string[] = [a.id]): Flow<void> {
    for (const photoId of photoIds) {
        const row = (yield* s.get('SELECT * FROM v2_uploads WHERE id=?', photoId));
        if (!row || row.task_id !== taskId || !allowedOwners.includes(String(row.owner_id)))
            fail('INVALID_PHOTO_REFERENCE', 'Photo must belong to this task and its contributors', 400);
        if (row.report_id !== null)
            fail('PHOTO_ALREADY_ATTACHED', 'Photo is already attached to a submitted report');
    }
}
