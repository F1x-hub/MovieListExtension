using System.Reflection;

var updater = Assembly.Load("MovieListUpdater").GetType("Program", throwOnError: true)!;
var move = updater.GetMethod("MoveWithRetry", BindingFlags.Static | BindingFlags.NonPublic)!;
var root = Directory.CreateTempSubdirectory("movielist-replacement-test-").FullName;
try
{
    var installed = Path.Combine(root, "MovieListExtension-1.3.0");
    var recovery = Path.Combine(root, ".movielist-updater", "recovery", Guid.NewGuid().ToString());
    var staged = Path.Combine(root, ".movielist-updater", "staging", "extension");
    Directory.CreateDirectory(installed);
    Directory.CreateDirectory(staged);
    File.WriteAllText(Path.Combine(installed, "manifest.json"), "old-version");
    File.WriteAllText(Path.Combine(staged, "manifest.json"), "new-version");
    move.Invoke(null, new object[] { installed, recovery });
    move.Invoke(null, new object[] { staged, installed });
    if (File.ReadAllText(Path.Combine(installed, "manifest.json")) != "new-version"
        || File.ReadAllText(Path.Combine(recovery, "manifest.json")) != "old-version")
        throw new Exception("Fresh-install replacement lost source or replacement contents.");
    Directory.Delete(installed, recursive: true);
    move.Invoke(null, new object[] { recovery, installed });
    if (File.ReadAllText(Path.Combine(installed, "manifest.json")) != "old-version")
        throw new Exception("Recovery did not restore the original installation.");
    Console.WriteLine("Fresh-install replacement and recovery passed.");
}
finally
{
    Directory.Delete(root, recursive: true);
}
