// SOSTITUISCI questi due valori con quelli del tuo progetto Supabase
const SUPABASE_URL = 'https://qpbnqrgxmkrrlkijeqyo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwYm5xcmd4bWtycmxraWplcXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4MjgwMjAsImV4cCI6MjEwNTQwNDAyMH0.SNjeoEGc76vWetgfTpfrzuEX2mnPfdgS371mZu2QR1s';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);