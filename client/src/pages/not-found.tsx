import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            This page doesn't exist. It may have been moved, or the link is out of date.
          </p>
          <Button asChild className="mt-6" data-testid="button-back-home">
            <Link href="/">Back to News Feed</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
