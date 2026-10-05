.conclusion.kind,
(.changeScope.files[] | [.path, .relation, (.checks | join(","))] | join(" ") | rtrimstr(" ")),
(.changeMap.connections[] | select(.kind == "ran-in")
  | "\(.from | ltrimstr("file:")) ran \(.ran) of \(.ran + .notRan) changed lines"),
(.journeys[].checks[]
  | "\(.id) \(.verdict)",
    "  \(.detail)",
    (.recipe.proposed? // empty | "  proposed \(.outcome): \(.expectation)"))
