require('dotenv').config();
const supabase = require('../lib/supabase');

async function createNotesTable() {
  console.log('Creating audit_notes table...');

  // Try creating via raw SQL
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS audit_notes (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
        note_text TEXT NOT NULL,
        ai_analysis JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_notes_audit_id ON audit_notes(audit_id);
    `
  });

  if (error) {
    console.error('RPC failed, trying insert test:', error.message);
    // Table might already exist or RPC not available
    // Try a test insert to see
    const testId = '00000000-0000-0000-0000-000000000000';
    const { error: e2 } = await supabase.from('audit_notes').select('id').limit(1);
    if (e2) {
      console.log('Table does not exist yet. Create it manually in Supabase with:');
      console.log(`
CREATE TABLE audit_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  ai_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_notes_audit_id ON audit_notes(audit_id);
      `);
    } else {
      console.log('Table audit_notes already exists!');
    }
  } else {
    console.log('Table created successfully!');
  }
}

createNotesTable().catch(console.error);
