import { pgTable, serial, text, integer, timestamp, boolean, unique } from 'drizzle-orm/pg-core';

export const regions = pgTable('regions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  parentId: integer('parent_id'),
});

export const rhythms = pgTable('rhythms', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const dromoi = pgTable('dromoi', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const composers = pgTable('composers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const songs = pgTable('songs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  lyrics: text('lyrics'),
  genreId: integer('genre_id').notNull().references(() => genres.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const axisTypes = pgTable('axis_types', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  lookupTable: text('lookup_table'),
  hierarchical: boolean('hierarchical').notNull().default(false),
});

export const songAxisValues = pgTable(
  'song_axis_values',
  {
    id: serial('id').primaryKey(),
    songId: integer('song_id').notNull().references(() => songs.id),
    axisType: text('axis_type').notNull().references(() => axisTypes.key),
    refId: integer('ref_id'),
    yearValue: integer('year_value'),
  },
  (table) => ({
    uniqueSongAxis: unique().on(table.songId, table.axisType),
  })
);

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  label: text('label'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  currentSongId: integer('current_song_id').references(() => songs.id),
});

export const sessionPlayedSongs = pgTable('session_played_songs', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references(() => sessions.id),
  songId: integer('song_id').notNull().references(() => songs.id),
  playedAt: timestamp('played_at').notNull().defaultNow(),
});

export const programs = pgTable('programs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
});

export const programSequences = pgTable('program_sequences', {
  id: serial('id').primaryKey(),
  programId: integer('program_id').notNull().references(() => programs.id),
  title: text('title').notNull(),
  position: integer('position').notNull(),
});

export const sequenceSongs = pgTable('sequence_songs', {
  id: serial('id').primaryKey(),
  sequenceId: integer('sequence_id').notNull().references(() => programSequences.id),
  songId: integer('song_id').notNull().references(() => songs.id),
  position: integer('position').notNull(),
});

export type RegionRow = typeof regions.$inferSelect;
export type RhythmRow = typeof rhythms.$inferSelect;
export type DromosRow = typeof dromoi.$inferSelect;
export type GenreRow = typeof genres.$inferSelect;
export type ComposerRow = typeof composers.$inferSelect;
export type SongRow = typeof songs.$inferSelect;
export type AxisTypeRow = typeof axisTypes.$inferSelect;
export type SongAxisValueRow = typeof songAxisValues.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SessionPlayedSongRow = typeof sessionPlayedSongs.$inferSelect;
export type ProgramRow = typeof programs.$inferSelect;
export type ProgramSequenceRow = typeof programSequences.$inferSelect;
export type SequenceSongRow = typeof sequenceSongs.$inferSelect;
