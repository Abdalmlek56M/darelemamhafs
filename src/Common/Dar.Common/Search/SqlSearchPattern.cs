namespace Dar.Common.Search;

/// <summary>
/// FINAL 2.2: turns untrusted user input into a safe case-insensitive "contains" pattern
/// for PostgreSQL LIKE/ILIKE. Without escaping, a search for "%" matches every row and a
/// search for "_" silently matches any single character. The backslash is PostgreSQL's
/// default LIKE escape character, so it must be escaped first.
/// </summary>
public static class SqlSearchPattern
{
    /// <summary>Escape character used by PostgreSQL LIKE/ILIKE when no ESCAPE clause is given.</summary>
    public const char EscapeCharacter = '\\';

    /// <summary>Escapes <c>\</c>, <c>%</c> and <c>_</c> so they match literally.</summary>
    public static string Escape(string? term)
    {
        var value = (term ?? string.Empty).Trim();
        if (value.Length == 0) return string.Empty;
        var escaped = new System.Text.StringBuilder(value.Length + 8);
        foreach (var character in value)
        {
            if (character is EscapeCharacter or '%' or '_') escaped.Append(EscapeCharacter);
            escaped.Append(character);
        }
        return escaped.ToString();
    }

    /// <summary>Builds the <c>%term%</c> pattern used by the student list contains search.</summary>
    public static string Contains(string? term) => "%" + Escape(term) + "%";
}
