import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { login } from "@/lib/auth-api";

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!password || loading) return;
    setLoading(true);
    setError(false);
    const ok = await login(password);
    setLoading(false);
    if (ok) {
      onSuccess();
    } else {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto bg-primary/10 text-primary p-3 rounded-md w-fit">
            <Bot size={28} />
          </div>
          <div>
            <CardTitle className="font-mono tracking-tight">JÚLIA</CardTitle>
            <CardDescription className="uppercase tracking-wider text-xs font-semibold">
              Command Center
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Senha de acesso</Label>
            <Input
              id="password"
              type="password"
              value={password}
              autoFocus
              placeholder="Digite sua senha"
              data-testid="input-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            {error && (
              <p className="text-sm text-destructive" data-testid="login-error">
                Senha incorreta. Tente novamente.
              </p>
            )}
          </div>
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={loading || !password}
            data-testid="btn-login"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Entrando...
              </>
            ) : (
              "Entrar"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
