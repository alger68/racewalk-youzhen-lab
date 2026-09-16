import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
export const sessions=sqliteTable("sessions",{
 id:text("id").primaryKey(),ownerId:text("owner_id").notNull(),athlete:text("athlete").notNull(),sessionDate:text("session_date").notNull(),
 view:text("view").notNull(),speed:text("speed").notNull(),pace:real("pace"),fileName:text("file_name").notNull(),
 resultKey:text("result_key").notNull(),summary:text("summary").notNull(),version:integer("version").notNull().default(1),
 videoKey:text("video_key"),createdAt:text("created_at").notNull(),updatedAt:text("updated_at").notNull()
},(t)=>[index("idx_sessions_owner_date").on(t.ownerId,t.sessionDate)]);
