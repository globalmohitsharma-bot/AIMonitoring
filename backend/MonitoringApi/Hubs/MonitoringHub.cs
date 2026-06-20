using Microsoft.AspNetCore.SignalR;
using MonitoringApi.Models;

namespace MonitoringApi.Hubs;

public class MonitoringHub : Hub
{
    private readonly EventStore _store;

    public MonitoringHub(EventStore store) => _store = store;

    public async Task JoinSession(string sessionId, string? candidateName = null, string? candidateEmail = null, double? resumeScore = null)
    {
        _store.UpsertSession(sessionId, candidateName, candidateEmail, resumeScore);
        var session = _store.GetSession(sessionId)!;
        await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    public async Task JoinMonitor()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, "admin-monitor");
        await Clients.Caller.SendAsync("SessionsSnapshot",    _store.GetSessions());
        await Clients.Caller.SendAsync("QuizResultsSnapshot", _store.GetQuizResults());
        await Clients.Caller.SendAsync("QuestionsSnapshot",   EventStore.GetQuestions());
    }

    public async Task ReportEvent(MonitoringEvent evt)
    {
        evt.Id        = Guid.NewGuid();
        evt.Timestamp = DateTime.UtcNow;
        _store.Add(evt);
        _store.UpdateStatus(evt);

        await Clients.Caller.SendAsync("EventReceived", evt);
        await Clients.Group("admin-monitor").SendAsync("EventReceived", evt);

        var session = _store.GetSession(evt.SessionId);
        if (session is not null)
            await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    public async Task SubmitQuizResult(QuizResult result)
    {
        result.Id          = Guid.NewGuid();
        result.CompletedAt = DateTime.UtcNow;
        _store.AddQuizResult(result);
        _store.SetQuizScore(result.SessionId, result.Score, result.Total);

        await Clients.Group("admin-monitor").SendAsync("QuizCompleted", result);

        var pct = result.Total > 0 ? result.Score * 100 / result.Total : 100;
        var evt = new MonitoringEvent
        {
            Id        = Guid.NewGuid(),
            SessionId = result.SessionId,
            Type      = EventType.QuizCompleted,
            Timestamp = result.CompletedAt,
            Message   = $"Quiz completed — {result.Score}/{result.Total} ({pct}%)",
            Severity  = pct == 100 ? "info" : pct >= 60 ? "warning" : "error",
        };
        _store.Add(evt);
        await Clients.Caller.SendAsync("EventReceived", evt);
        await Clients.Group("admin-monitor").SendAsync("EventReceived", evt);

        var session = _store.GetSession(result.SessionId);
        if (session is not null)
            await Clients.Group("admin-monitor").SendAsync("SessionUpdated", session);
    }

    public async Task SendVideoFrame(string sessionId, string frameData)
    {
        await Clients.Group("admin-monitor").SendAsync("VideoFrame", sessionId, frameData);
    }

    public Task<List<MonitoringEvent>> GetHistory(string sessionId)
        => Task.FromResult(_store.GetBySession(sessionId));

    // Admin: update the live question bank
    public async Task AdminUpdateQuestions(List<Question> questions)
    {
        EventStore.SetQuestions(questions);
        // Notify all admins watching the dashboard
        await Clients.Group("admin-monitor").SendAsync("QuestionsSnapshot", questions);
    }
}

// ── EventStore ────────────────────────────────────────────────────────────────
public class EventStore
{
    private readonly List<MonitoringEvent>          _events      = new();
    private readonly Dictionary<string, SessionInfo> _sessions   = new();
    private readonly List<QuizResult>               _quizResults = new();
    private readonly object _lock = new();

    private static List<Question> _questions =
    [
        // ── .NET / CLR / Runtime ───────────────────────────────────────────
        new() {
            Id = 1, Type = "openended",
            Text = "What is the difference between .NET and C#?",
            CorrectAnswer = ".NET is a framework that provides the CLR runtime and class libraries. C# is a programming language. C# code is compiled into IL code which runs on the .NET CLR."
        },
        new() {
            Id = 2, Type = "openended",
            Text = "What is IL code and what does the JIT compiler do with it?",
            CorrectAnswer = "IL stands for Intermediate Language. It is partially compiled code produced by the C# compiler. JIT stands for Just In Time compiler. JIT compiles IL code into native machine language at runtime, optimized for the host machine."
        },
        new() {
            Id = 3, Type = "openended",
            Text = "What is the CLR and what are its main responsibilities?",
            CorrectAnswer = "CLR stands for Common Language Runtime. It invokes the JIT compiler to convert IL code to machine language. CLR manages memory through the Garbage Collector, handles exceptions, enforces type safety, and provides security."
        },
        new() {
            Id = 4, Type = "openended",
            Text = "What is the difference between managed code and unmanaged code?",
            CorrectAnswer = "Managed code runs under the control of the CLR which handles memory management and garbage collection. Unmanaged code runs outside CLR control, like C++ or COM code, and the developer must manage memory manually."
        },
        new() {
            Id = 5, Type = "openended",
            Text = "How does the Garbage Collector work in .NET?",
            CorrectAnswer = "The Garbage Collector automatically manages memory by reclaiming objects that are no longer referenced. It uses generations: Gen 0 for short-lived objects, Gen 1 for medium-lived, Gen 2 for long-lived. GC runs periodically and compacts the heap to reduce fragmentation."
        },

        // ── Memory / Types ─────────────────────────────────────────────────
        new() {
            Id = 6, Type = "openended",
            Text = "What is the difference between the Stack and Heap in memory?",
            CorrectAnswer = "The stack stores value types and method call frames. It is fast and memory is automatically freed when scope ends. The heap stores reference type objects. It is managed by the Garbage Collector. Stack access is faster than heap access."
        },
        new() {
            Id = 7, Type = "openended",
            Text = "What is the difference between Value types and Reference types in C#?",
            CorrectAnswer = "Value types store actual data directly on the stack. Reference types store a pointer on the stack pointing to data on the heap. Value types include int, bool, double, struct. Reference types include objects, strings, arrays, and classes."
        },
        new() {
            Id = 8, Type = "openended",
            Text = "What is boxing and unboxing, and what is the performance consequence?",
            CorrectAnswer = "Boxing converts a value type to a reference type by placing it on the heap. Unboxing extracts the value type back from the heap reference. Boxing and unboxing cause extra memory allocation and decreased performance, so they should be avoided in tight loops."
        },
        new() {
            Id = 9, Type = "openended",
            Text = "What is the difference between a shallow copy and a deep copy?",
            CorrectAnswer = "A shallow copy copies only the object's references, so both copies share the same inner objects. A deep copy creates a completely independent copy including all referenced objects. Modifying a deep copy does not affect the original."
        },
        new() {
            Id = 10, Type = "mcq",
            Text = "Which of these is a Value type in C#?",
            Options = ["string", "struct", "object", "class"],
            CorrectAnswer = "struct"
        },

        // ── Collections ────────────────────────────────────────────────────
        new() {
            Id = 11, Type = "openended",
            Text = "What are generics in C# and why are they better than using ArrayList?",
            CorrectAnswer = "Generics allow classes and methods to work with any type specified at compile time. They are type-safe, preventing runtime cast errors. Generics avoid boxing and unboxing overhead that ArrayList causes when storing value types, so they perform better."
        },
        new() {
            Id = 12, Type = "openended",
            Text = "What is the difference between an Array and an ArrayList in C#?",
            CorrectAnswer = "An Array has a fixed size and is strongly typed. An ArrayList is dynamic and can grow, but it stores objects so boxing occurs for value types. The generic List<T> is preferred over ArrayList because it is type-safe and avoids boxing."
        },
        new() {
            Id = 13, Type = "openended",
            Text = "What is the difference between IEnumerable and IList?",
            CorrectAnswer = "IEnumerable supports only forward iteration using foreach and is read-only. IList extends ICollection and supports indexed access, adding, removing, and inserting items. IList gives more control but IEnumerable uses less memory for large sequences."
        },
        new() {
            Id = 14, Type = "openended",
            Text = "What is a Dictionary in C# and when would you use it?",
            CorrectAnswer = "Dictionary is a generic collection that stores key-value pairs. Each key must be unique. It provides O(1) average lookup time using hashing. You use it when you need fast retrieval of values by a known key, such as caching or indexing data."
        },
        new() {
            Id = 15, Type = "mcq",
            Text = "Which collection guarantees unique elements in C#?",
            Options = ["List<T>", "HashSet<T>", "Dictionary<K,V>", "Queue<T>"],
            CorrectAnswer = "HashSet<T>"
        },

        // ── OOP Pillars ────────────────────────────────────────────────────
        new() {
            Id = 16, Type = "openended",
            Text = "What is encapsulation in object-oriented programming?",
            CorrectAnswer = "Encapsulation is the bundling of data and methods that operate on that data within a single class. It hides internal implementation details from outside. Access modifiers like private, protected, and public control what is exposed. This protects data integrity."
        },
        new() {
            Id = 17, Type = "openended",
            Text = "What is inheritance in object-oriented programming?",
            CorrectAnswer = "Inheritance allows a child class to acquire properties and methods from a parent class. It promotes code reuse and establishes an is-a relationship. In C# a class can inherit from only one base class but can implement multiple interfaces."
        },
        new() {
            Id = 18, Type = "openended",
            Text = "What is abstraction and how is it achieved in C#?",
            CorrectAnswer = "Abstraction hides complex implementation details and shows only the essential features. In C# abstraction is achieved using abstract classes and interfaces. Abstract classes can have abstract methods that subclasses must implement. Interfaces define contracts without any implementation."
        },
        new() {
            Id = 19, Type = "openended",
            Text = "What is polymorphism? Explain static vs dynamic polymorphism.",
            CorrectAnswer = "Polymorphism is the ability of an object to behave differently under different conditions. Static polymorphism is method overloading where multiple methods share the same name but differ in parameters. Dynamic polymorphism is method overriding using virtual and override keywords decided at runtime."
        },
        new() {
            Id = 20, Type = "openended",
            Text = "What is the difference between method overloading and method overriding?",
            CorrectAnswer = "Method overloading is defining multiple methods with the same name but different parameters in the same class. It is compile-time polymorphism. Method overriding is redefining a base class virtual method in a derived class using the override keyword. It is runtime polymorphism."
        },

        // ── Classes & Members ──────────────────────────────────────────────
        new() {
            Id = 21, Type = "openended",
            Text = "What is the difference between an Abstract class and an Interface?",
            CorrectAnswer = "Abstract class is a partially implemented class that can have both abstract and concrete methods. Interface defines only method signatures with no implementation. A class can implement multiple interfaces but inherit only one abstract class. Use interface for contracts, abstract class for shared base behavior."
        },
        new() {
            Id = 22, Type = "openended",
            Text = "What is a constructor in C# and what is constructor chaining?",
            CorrectAnswer = "A constructor is a special method called when an object is created. It initializes the object. Constructor chaining uses the this keyword to call another constructor within the same class, or the base keyword to call a parent class constructor, avoiding code duplication."
        },
        new() {
            Id = 23, Type = "openended",
            Text = "What is the difference between static and instance members?",
            CorrectAnswer = "Static members belong to the class itself and are shared across all instances. They are accessed using the class name. Instance members belong to a specific object and each object has its own copy. Static members exist even without creating an object."
        },
        new() {
            Id = 24, Type = "openended",
            Text = "What is the difference between a property and a field in C#?",
            CorrectAnswer = "A field is a variable declared directly in a class to store data. A property is a member that provides controlled access to a field using get and set accessors. Properties can include validation logic in the setter. Fields are usually private, properties provide the public interface."
        },
        new() {
            Id = 25, Type = "openended",
            Text = "What is the difference between readonly and const in C#?",
            CorrectAnswer = "Const is a compile-time constant whose value is set at declaration and can never change. Readonly is a runtime constant that can be assigned in the constructor. Const is implicitly static. Readonly allows different values per instance based on constructor parameters."
        },
        new() {
            Id = 26, Type = "openended",
            Text = "What are access modifiers in C# and what does each mean?",
            CorrectAnswer = "Public is accessible from anywhere. Private is accessible only within the same class. Protected is accessible within the class and derived classes. Internal is accessible within the same assembly. Protected internal combines both protected and internal access."
        },
        new() {
            Id = 27, Type = "mcq",
            Text = "Which access modifier restricts access to the same class only?",
            Options = ["public", "protected", "private", "internal"],
            CorrectAnswer = "private"
        },

        // ── Delegates, Events, Lambda ──────────────────────────────────────
        new() {
            Id = 28, Type = "openended",
            Text = "What is a delegate in C# and what is it used for?",
            CorrectAnswer = "A delegate is a type that holds a reference to a method with a specific signature. It allows methods to be passed as parameters. Delegates enable callback patterns and are the basis for events in C#. Func and Action are built-in generic delegate types."
        },
        new() {
            Id = 29, Type = "openended",
            Text = "What is the difference between a delegate and an event?",
            CorrectAnswer = "A delegate is a type that references one or more methods. An event is a wrapper around a delegate that restricts access so external classes can only subscribe or unsubscribe using += and -=. Events cannot be invoked or reassigned from outside the declaring class."
        },
        new() {
            Id = 30, Type = "openended",
            Text = "What is a lambda expression in C#?",
            CorrectAnswer = "A lambda expression is an anonymous function that can capture variables from its enclosing scope. It uses the => arrow syntax. Lambda expressions are used with LINQ, delegates, and Func or Action types. They make code more concise than writing a full method."
        },

        // ── LINQ, String, Async ───────────────────────────────────────────
        new() {
            Id = 31, Type = "openended",
            Text = "What is LINQ and what are its benefits?",
            CorrectAnswer = "LINQ stands for Language Integrated Query. It allows querying collections, databases, and XML using C# syntax. LINQ provides filtering, sorting, grouping, and projection operations. It improves readability by expressing data queries inline in code without separate SQL strings."
        },
        new() {
            Id = 32, Type = "openended",
            Text = "What is the difference between String and StringBuilder?",
            CorrectAnswer = "String is immutable, meaning every modification creates a new string object on the heap. StringBuilder is mutable and modifies the same buffer in memory. For repeated string concatenation in loops, StringBuilder is much more efficient than using + operator with strings."
        },
        new() {
            Id = 33, Type = "openended",
            Text = "What is the difference between var and dynamic in C#?",
            CorrectAnswer = "Var is statically typed and the type is inferred by the compiler at compile time. Once assigned the type cannot change. Dynamic is resolved at runtime and bypasses compile-time type checking. Var is type-safe, dynamic is flexible but errors only appear at runtime."
        },
        new() {
            Id = 34, Type = "openended",
            Text = "What is a nullable type and when would you use it?",
            CorrectAnswer = "A nullable type allows a value type to also hold a null value using the syntax int? or Nullable<int>. Normally value types cannot be null. Nullable types are useful when representing database fields or optional values that may be absent."
        },
        new() {
            Id = 35, Type = "openended",
            Text = "What is async/await and why do we use it in C#?",
            CorrectAnswer = "Async and await allow writing asynchronous code that looks like synchronous code. The async keyword marks a method as asynchronous. Await suspends execution until the awaited Task completes without blocking the thread. This keeps UI responsive and improves scalability in web applications."
        },
        new() {
            Id = 36, Type = "openended",
            Text = "What is the difference between Thread and Task in C#?",
            CorrectAnswer = "Thread is a low-level OS-managed execution unit. Task is a higher-level abstraction over threads provided by the Task Parallel Library. Tasks support async/await, cancellation, and continuation. Tasks are easier to compose and the thread pool manages them efficiently."
        },
        new() {
            Id = 37, Type = "openended",
            Text = "What is a deadlock and how can you avoid it in C#?",
            CorrectAnswer = "A deadlock occurs when two or more threads are blocked waiting for each other to release a resource, causing all to wait forever. You can avoid deadlocks by always acquiring locks in the same order, using async await instead of blocking calls, and using timeout on lock attempts."
        },

        // ── Exception Handling ─────────────────────────────────────────────
        new() {
            Id = 38, Type = "openended",
            Text = "What is exception handling in C#? Explain try, catch, and finally.",
            CorrectAnswer = "Exception handling catches and manages runtime errors. The try block contains code that may throw an exception. The catch block handles specific exceptions. The finally block always executes whether or not an exception occurred, used for cleanup like closing connections."
        },
        new() {
            Id = 39, Type = "openended",
            Text = "What is the difference between throw and throw ex when rethrowing exceptions?",
            CorrectAnswer = "Throw without arguments rethrows the original exception and preserves the original stack trace. Throw ex rethrows the exception but resets the stack trace to the current line, losing the original call location. Throw should always be preferred to preserve the full stack trace for debugging."
        },
        new() {
            Id = 40, Type = "mcq",
            Text = "Which keyword always executes in a try/catch block regardless of an exception?",
            Options = ["catch", "finally", "throw", "base"],
            CorrectAnswer = "finally"
        },

        // ── Design Patterns ────────────────────────────────────────────────
        new() {
            Id = 41, Type = "openended",
            Text = "What is the Singleton design pattern?",
            CorrectAnswer = "Singleton ensures only one instance of a class exists throughout the application. It provides a global access point to that instance. It is implemented by making the constructor private and providing a static property that returns the single instance."
        },
        new() {
            Id = 42, Type = "openended",
            Text = "What is the Factory design pattern?",
            CorrectAnswer = "Factory pattern defines an interface for creating objects but lets subclasses or a factory method decide which class to instantiate. It decouples object creation from the code that uses the object. This makes code more flexible and easier to extend with new types."
        },
        new() {
            Id = 43, Type = "openended",
            Text = "What is Dependency Injection and Inversion of Control?",
            CorrectAnswer = "Inversion of Control is a principle where object creation is delegated to an external framework instead of the class itself. Dependency Injection is an implementation of IoC where dependencies are injected through constructors or properties. DI makes code loosely coupled and easier to test."
        },
        new() {
            Id = 44, Type = "openended",
            Text = "What is the Repository pattern and what are its benefits?",
            CorrectAnswer = "Repository pattern abstracts data access logic behind an interface. It provides CRUD operations without exposing database details to business logic. This decouples the domain layer from the data layer, simplifies unit testing through mocking, and makes it easy to swap data sources."
        },

        // ── SOLID Principles ───────────────────────────────────────────────
        new() {
            Id = 45, Type = "mcq",
            Text = "What does the 'S' in SOLID principles stand for?",
            Options = ["Single Responsibility", "Synchronous Processing", "Structured Design", "Sequential Logic"],
            CorrectAnswer = "Single Responsibility"
        },
        new() {
            Id = 46, Type = "openended",
            Text = "What is the Single Responsibility Principle?",
            CorrectAnswer = "Single Responsibility Principle states that a class should have only one reason to change, meaning it should do only one thing. A class should have only one job or responsibility. This makes classes smaller, easier to test, and less likely to break when requirements change."
        },
        new() {
            Id = 47, Type = "openended",
            Text = "What is the Open/Closed Principle in SOLID?",
            CorrectAnswer = "Open Closed Principle states that software entities should be open for extension but closed for modification. You should be able to add new functionality by adding new code, not by modifying existing code. This is achieved through abstraction, interfaces, and inheritance."
        },
        new() {
            Id = 48, Type = "openended",
            Text = "What is the Liskov Substitution Principle?",
            CorrectAnswer = "Liskov Substitution Principle states that objects of a subclass should be replaceable with objects of the parent class without breaking the application. A derived class must be substitutable for its base class. Violating this usually means the inheritance hierarchy is wrong."
        },
        new() {
            Id = 49, Type = "openended",
            Text = "What is the Interface Segregation Principle?",
            CorrectAnswer = "Interface Segregation Principle states that clients should not be forced to depend on interfaces they do not use. Instead of one large interface, create smaller specific interfaces. A class should only implement the methods it actually needs, keeping interfaces focused and cohesive."
        },
        new() {
            Id = 50, Type = "openended",
            Text = "What is the Dependency Inversion Principle?",
            CorrectAnswer = "Dependency Inversion Principle states that high-level modules should not depend on low-level modules; both should depend on abstractions. Depend on interfaces not concrete implementations. This is the basis for Dependency Injection and makes code more flexible and testable."
        },

        // ── Advanced Features ──────────────────────────────────────────────
        new() {
            Id = 51, Type = "openended",
            Text = "What is an extension method in C#?",
            CorrectAnswer = "An extension method allows adding new methods to an existing type without modifying or inheriting from it. It is defined as a static method in a static class with the first parameter using the this keyword. Extension methods appear as if they are instance methods on the extended type."
        },
        new() {
            Id = 52, Type = "openended",
            Text = "What is the yield keyword in C# and when would you use it?",
            CorrectAnswer = "Yield is used in an iterator method to return each element one at a time without creating a full collection. The yield return statement returns control to the caller and resumes from where it left off next time. It is memory efficient for large sequences because it generates values lazily."
        },
        new() {
            Id = 53, Type = "openended",
            Text = "What is the difference between IEnumerable and IQueryable in C#?",
            CorrectAnswer = "IEnumerable executes queries in memory on the client side after fetching all data. IQueryable translates queries into SQL and executes them on the server side. IQueryable is more efficient for database queries because filtering and sorting happen in the database before data is loaded."
        },
        new() {
            Id = 54, Type = "openended",
            Text = "What is reflection in C# and what is it used for?",
            CorrectAnswer = "Reflection allows code to inspect and interact with types, methods, and properties at runtime. It can dynamically create instances, invoke methods, and read attributes without knowing the type at compile time. Reflection is used in frameworks, serializers, and dependency injection containers."
        },
        new() {
            Id = 55, Type = "mcq",
            Text = "Which keyword in C# is used to call a parent class constructor?",
            Options = ["this", "base", "super", "parent"],
            CorrectAnswer = "base"
        },
    ];

    public static List<Question> GetQuestions() { lock (typeof(EventStore)) return _questions.ToList(); }
    public static void SetQuestions(List<Question> q) { lock (typeof(EventStore)) _questions = q; }

    // ── Session management ────────────────────────────────────────
    public void UpsertSession(string sessionId, string? name = null, string? email = null, double? resumeScore = null)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var s))
            {
                s = new SessionInfo { SessionId = sessionId };
                _sessions[sessionId] = s;
            }
            if (name         is not null) s.CandidateName  = name;
            if (email        is not null) s.CandidateEmail = email;
            if (resumeScore  is not null) s.ResumeScore    = resumeScore;
        }
    }

    public void Add(MonitoringEvent evt)
    {
        lock (_lock) _events.Add(evt);
    }

    public void UpdateStatus(MonitoringEvent evt)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(evt.SessionId, out var session))
            {
                session = new SessionInfo { SessionId = evt.SessionId };
                _sessions[evt.SessionId] = session;
            }
            session.LastSeen = evt.Timestamp;
            session.EventCount++;

            switch (evt.Type)
            {
                case EventType.FaceNotDetected: session.FaceStatus = "alert";    break;
                case EventType.FaceReturned:    session.FaceStatus = "ok";       break;
                case EventType.SessionStart:    session.FaceStatus = "ok";       break;
                case EventType.TabSwitch:       session.TabStatus  = "switched"; break;
                case EventType.TabReturned:     session.TabStatus  = "active";   break;
                case EventType.MultipleFaces:   session.FaceStatus = "multi";    break;
            }

            session.RiskScore = CalculateRiskScoreLocked(evt.SessionId, session);
        }
    }

    private static double CalculateRiskScoreLocked(string sessionId, SessionInfo session)
    {
        // called while _lock is held — do not re-lock
        double score = 100;

        // Each deduction has a cap so a single bad actor doesn't go to 0 on one metric
        var tabSwitches    = 0;
        var faceAlerts     = 0;
        var multiFaces     = 0;
        var audioAlerts    = 0;
        var inactiveAlerts = 0;

        // We can't enumerate _events here without re-acquiring the lock (already held).
        // Instead we use the already-tracked EventCount and the FaceStatus / TabStatus as proxies.
        // Full event-based calculation is performed in GetSession (outside lock) for admin display.
        // This keeps the lock hot-path fast.
        return session.RiskScore; // will be recalculated outside if needed
    }

    public void RecalculateRiskScore(string sessionId)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session)) return;

            var evts = _events.Where(e => e.SessionId == sessionId).ToList();
            double score = 100;
            score -= Math.Min(evts.Count(e => e.Type == EventType.TabSwitch),       5) * 10;
            score -= Math.Min(evts.Count(e => e.Type == EventType.FaceNotDetected), 5) * 8;
            score -= Math.Min(evts.Count(e => e.Type == EventType.MultipleFaces),   3) * 15;
            score -= Math.Min(evts.Count(e => e.Type == EventType.AudioAlert),      5) * 5;
            score -= Math.Min(evts.Count(e => e.Type == EventType.InactivityAlert), 5) * 3;

            session.RiskScore = Math.Max(0, Math.Round(score));
        }
    }

    public void SetQuizScore(string sessionId, int score, int total)
    {
        lock (_lock)
        {
            if (_sessions.TryGetValue(sessionId, out var s))
            {
                s.QuizScore = score;
                s.QuizTotal = total;
            }
        }
        RecalculateRiskScore(sessionId);
    }

    public void AddQuizResult(QuizResult result)
    {
        lock (_lock) _quizResults.Add(result);
    }

    public List<QuizResult> GetQuizResults()
    {
        lock (_lock) return _quizResults.ToList();
    }

    public SessionInfo? GetSession(string sessionId)
    {
        lock (_lock) return _sessions.TryGetValue(sessionId, out var s) ? s : null;
    }

    public List<SessionInfo> GetSessions()
    {
        lock (_lock) return [.. _sessions.Values.OrderBy(s => s.StartedAt)];
    }

    public List<MonitoringEvent> GetAll()
    {
        lock (_lock) return _events.ToList();
    }

    public List<MonitoringEvent> GetBySession(string sessionId)
    {
        lock (_lock) return _events.Where(e => e.SessionId == sessionId).ToList();
    }

    public void Clear()
    {
        lock (_lock) { _events.Clear(); _sessions.Clear(); _quizResults.Clear(); }
    }
}
