import { Suspense } from "react";
import { CreateClassForm } from "@/components/class/CreateClassForm";
import { JoinClassForm } from "@/components/class/JoinClassForm";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chevron, List, ListRow } from "@/components/ui/List";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import { requireStudent } from "@/lib/auth/session";
import { listStudentClasses, listTeacherClasses } from "@/lib/data/classes";

export const metadata = { title: "Classes | AutoFlash" };

export default function ClassesPage() {
  return (
    <Suspense fallback={<LoadingState title="Loading your classes…" />}>
      <ClassesHome />
    </Suspense>
  );
}

async function ClassesHome() {
  const user = await requireStudent();
  if (user.role !== "teacher") return <StudentClasses />;
  const classes = await listTeacherClasses();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Classes"
        description="Create a class, share the code, and add the flashcards your students will study."
        actions={
          <Modal
            triggerLabel="Create class"
            title="Create a class"
            description="You will get a code to share with your students."
          >
            <CreateClassForm />
          </Modal>
        }
      />

      {classes.length === 0 ? (
        <EmptyState title="No classes yet" description="Use Create class to make your first one." />
      ) : (
        <section aria-labelledby="class-list-heading">
          <SectionHeader id="class-list-heading" title="Your classes" count={classes.length} />
          <List>
            {classes.map((klass) => (
              <ListRow
                key={klass.id}
                href={`/classes/${klass.id}`}
                primary={klass.name}
                secondary={
                  <>
                    Code <span className="font-mono tracking-widest text-ink-secondary">{klass.code}</span>
                  </>
                }
                aside={<Chevron />}
              />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}

async function StudentClasses() {
  const classes = await listStudentClasses();

  return (
    <div className="space-y-4">
      <PageHeader
        title="My classes"
        description={
          classes.length === 0
            ? "Enter the code from your teacher to join a class."
            : "Open a class to study the decks your teacher made."
        }
        actions={
          <Modal
            triggerLabel="Join class"
            title="Join a class"
            description="Enter the 6-character code from your teacher."
          >
            <JoinClassForm />
          </Modal>
        }
      />

      {classes.length === 0 ? (
        <EmptyState title="No classes yet" description="Use Join class to enter the code your teacher gave you." />
      ) : (
        <section aria-labelledby="class-list-heading">
          <SectionHeader id="class-list-heading" title="Joined classes" count={classes.length} />
          <List>
            {classes.map((klass) => (
              <ListRow
                key={klass.id}
                href={`/classes/${klass.id}`}
                primary={klass.name}
                secondary={
                  klass.deckCount === 0
                    ? "No decks yet"
                    : `${klass.deckCount} ${klass.deckCount === 1 ? "deck" : "decks"}`
                }
                aside={
                  <>
                    {klass.deckCount > 0 &&
                      (klass.stillToLearn > 0 ? (
                        <Badge tone="warning">{klass.stillToLearn} to learn</Badge>
                      ) : (
                        <Badge tone="success">All known</Badge>
                      ))}
                    <Chevron />
                  </>
                }
              />
            ))}
          </List>
        </section>
      )}
    </div>
  );
}
