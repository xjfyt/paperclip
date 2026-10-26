import { pgTable, uuid, text, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { routines } from "./routines.js";
/** No schedule: the existing routine owns triggers, timezone, assignment and execution. */
export const mimouseResearchRoutineBindings = pgTable("mimouse_research_routine_bindings", {
  companyId: uuid("company_id").notNull().references(() => companies.id),
  routineId: uuid("routine_id").notNull().references(() => routines.id),
  product: text("product").notNull(), enabled: boolean("enabled").notNull().default(false),
  configuredByUserId: text("configured_by_user_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ pk: primaryKey({ columns: [t.companyId, t.routineId] }) }));
