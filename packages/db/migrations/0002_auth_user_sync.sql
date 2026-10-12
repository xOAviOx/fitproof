-- Mirror Supabase Auth users into public.users. Deleting the auth user
-- cascades through public.users to every user-owned row.
CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- SECURITY DEFINER functions in `public` are callable over the Data API unless revoked.
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_change() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_change ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_change
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_change();
--> statement-breakpoint
INSERT INTO public.users (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
