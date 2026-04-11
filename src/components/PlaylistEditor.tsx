import { useState, useEffect } from "react";
import { ListMusic, Plus, Trash2, GripVertical, FileVideo, Save, X, Film } from "lucide-react";
import { Button } from "./ui/Button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "./ui/Card";
import { Input } from "./ui/Input";
import { Badge } from "./ui/Badge";
import { Media, Playlist } from "../types";
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db, auth } from "../firebase";
import { cn } from "../lib/utils";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableItemProps {
  id: string;
  mediaId: string;
  index: number;
  item?: Media;
  onRemove: (index: number) => void;
  key?: string;
}

function SortableItem({ id, mediaId, index, item, onRemove }: SortableItemProps) {
  const displayName = (m: Media) => m.artistName && m.songTitle 
    ? `${m.artistName} — ${m.songTitle}` 
    : m.songTitle || m.artistName || m.name;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  const isAdBreak = mediaId === "__AD_BREAK__";

  if (isAdBreak) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg group"
      >
        <div {...attributes} {...listeners} className="cursor-grab">
          <GripVertical className="h-4 w-4 text-amber-400" />
        </div>
        <div className="h-10 w-16 bg-amber-100 rounded flex items-center justify-center overflow-hidden">
          <Film className="h-4 w-4 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900">AD BREAK</p>
          <p className="text-xs text-amber-600">Mid-roll insertion point</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onRemove(index)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg group"
    >
      <div {...attributes} {...listeners} className="cursor-grab">
        <GripVertical className="h-4 w-4 text-zinc-400" />
      </div>
      <div className="h-10 w-16 bg-zinc-200 rounded flex items-center justify-center overflow-hidden">
        <FileVideo className="h-4 w-4 text-zinc-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{item ? displayName(item) : "Unknown Media"}</p>
          {item?.genre && (
            <Badge className={cn(
              "text-[8px] h-3.5 px-1 border-none text-white",
              item.genre === "Hip Hop" ? "bg-purple-600" :
              item.genre === "Rock" ? "bg-red-600" :
              item.genre === "EDM" ? "bg-blue-600" :
              item.genre === "R&B" ? "bg-pink-600" :
              item.genre === "Latin" ? "bg-amber-600" : "bg-zinc-600"
            )}>
              {item.genre}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{item?.duration ? `${Math.floor(item.duration / 60)} min` : "No duration"}</span>
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onRemove(index)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PlaylistEditor({ profile }: { profile: any }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);

  const displayName = (m: Media) => m.artistName && m.songTitle 
    ? `${m.artistName} — ${m.songTitle}` 
    : m.songTitle || m.artistName || m.name;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!auth.currentUser || !profile) return;

    const isMaster = profile.role === "master_admin";
    const targetUserId = isMaster ? null : (profile.ownerUserId || auth.currentUser.uid);

    let playlistsQ = query(collection(db, "playlists"));
    let mediaQ = query(collection(db, "media"));

    if (targetUserId) {
      playlistsQ = query(playlistsQ, where("userId", "==", targetUserId));
      mediaQ = query(mediaQ, where("userId", "==", targetUserId));
    }

    const unsubscribePlaylists = onSnapshot(playlistsQ, (snapshot) => {
      setPlaylists(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Playlist[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "playlists");
    });

    const unsubscribeMedia = onSnapshot(mediaQ, (snapshot) => {
      setMedia(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Media[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, "media");
    });

    return () => {
      unsubscribePlaylists();
      unsubscribeMedia();
    };
  }, []);

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName || !auth.currentUser) return;

    try {
      await addDoc(collection(db, "playlists"), {
        name: newPlaylistName,
        items: [],
        userId: auth.currentUser.uid,
        createdAt: new Date().toISOString(),
      });
      setNewPlaylistName("");
      setIsCreating(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "playlists");
    }
  };

  const handleSavePlaylist = async () => {
    if (!editingPlaylist) return;

    try {
      await updateDoc(doc(db, "playlists", editingPlaylist.id), {
        items: editingPlaylist.items,
        name: editingPlaylist.name,
      });
      setEditingPlaylist(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `playlists/${editingPlaylist.id}`);
    }
  };

  const handleDeletePlaylist = async (id: string) => {
    try {
      await deleteDoc(doc(db, "playlists", id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `playlists/${id}`);
    }
  };

  const addToPlaylist = (mediaId: string) => {
    if (!editingPlaylist) return;
    setEditingPlaylist({
      ...editingPlaylist,
      items: [...editingPlaylist.items, { id: `${mediaId}-${Date.now()}`, mediaId }],
    });
  };

  const removeFromPlaylist = (index: number) => {
    if (!editingPlaylist) return;
    const newItems = [...editingPlaylist.items];
    newItems.splice(index, 1);
    setEditingPlaylist({
      ...editingPlaylist,
      items: newItems,
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (editingPlaylist && over && active.id !== over.id) {
      const oldIndex = editingPlaylist.items.findIndex(i => i.id === active.id);
      const newIndex = editingPlaylist.items.findIndex(i => i.id === over.id);

      setEditingPlaylist({
        ...editingPlaylist,
        items: arrayMove(editingPlaylist.items, oldIndex, newIndex),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Playlists</h2>
          <p className="text-zinc-500">Create and sequence your media content.</p>
        </div>
        <Button onClick={() => setIsCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Playlist
        </Button>
      </div>

      {isCreating && (
        <Card className="border-zinc-900 shadow-lg">
          <CardHeader>
            <CardTitle>New Playlist</CardTitle>
            <CardDescription>Create a sequence of media items.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Playlist Name</label>
              <Input
                placeholder="e.g. Morning News Block"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsCreating(false)}>Cancel</Button>
            <Button onClick={handleCreatePlaylist}>Create Playlist</Button>
          </CardFooter>
        </Card>
      )}

      {editingPlaylist ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Editing: {editingPlaylist.name}</CardTitle>
                  <CardDescription>Drag and drop to reorder media items.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setEditingPlaylist(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                  <Button onClick={handleSavePlaylist}>
                    <Save className="mr-2 h-4 w-4" />
                    Save Changes
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={editingPlaylist.items.map(i => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {editingPlaylist.items.map((item, index) => (
                      <SortableItem
                        key={item.id}
                        id={item.id}
                        mediaId={item.mediaId || "__AD_BREAK__"}
                        index={index}
                        item={media.find(m => m.id === item.mediaId)}
                        onRemove={removeFromPlaylist}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
                {editingPlaylist.items.length > 0 && (
                  <Button 
                    variant="outline" 
                    className="w-full border-dashed border-amber-300 bg-amber-50/50 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    onClick={() => setEditingPlaylist({
                      ...editingPlaylist,
                      items: [...editingPlaylist.items, { id: `ad-break-${Date.now()}`, isAdBreak: true }]
                    })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Insert Ad Break
                  </Button>
                )}
                {editingPlaylist.items.length === 0 && (
                  <div className="text-center py-12 text-zinc-500 border-2 border-dashed border-zinc-200 rounded-lg">
                    No media items in this playlist. Add some from the library.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm uppercase tracking-widest font-bold text-zinc-500">Media Library</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
                {media.filter(m => m.status === "ready").map((item) => (
                  <div 
                    key={item.id}
                    className="flex items-center gap-3 p-2 hover:bg-zinc-50 border border-transparent hover:border-zinc-200 rounded-lg transition-all group"
                  >
                    <div className="h-8 w-12 bg-zinc-100 rounded flex items-center justify-center shrink-0">
                      <FileVideo className="h-3 w-3 text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{displayName(item)}</p>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span>{item.genre}</span>
                        <span>•</span>
                        <span>{item.duration ? `${Math.floor(item.duration / 60)} min` : "No duration"}</span>
                      </div>
                    </div>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-6 w-6"
                      onClick={() => addToPlaylist(item.id)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {playlists.map((playlist) => (
            <Card key={playlist.id} className="group hover:border-zinc-400 transition-colors cursor-pointer" onClick={() => setEditingPlaylist(playlist)}>
              <CardHeader>
                <div className="flex items-center justify-between mb-2">
                  <Badge className={cn(
                    "border-none text-white",
                    playlist.genre === "Hip Hop" ? "bg-purple-600" :
                    playlist.genre === "Rock" ? "bg-red-600" :
                    playlist.genre === "EDM" ? "bg-blue-600" :
                    playlist.genre === "R&B" ? "bg-pink-600" :
                    playlist.genre === "Latin" ? "bg-amber-600" : "bg-zinc-600"
                  )}>
                    {playlist.genre || "General"}
                  </Badge>
                </div>
                <CardTitle className="flex items-center gap-2">
                  <ListMusic className="h-5 w-5 text-zinc-400" />
                  {playlist.name}
                </CardTitle>
                <CardDescription>
                  {(playlist.items || []).length} items • Created {new Date(playlist.createdAt).toLocaleDateString()}
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-between">
                <Button variant="outline" size="sm">Edit Sequence</Button>
                <Button 
                  size="icon" 
                  variant="ghost" 
                  className="h-8 w-8 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePlaylist(playlist.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))}

          {playlists.length === 0 && !isCreating && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 border-2 border-dashed border-zinc-200 rounded-xl bg-zinc-50">
              <ListMusic className="h-12 w-12 text-zinc-300 mb-4" />
              <h3 className="text-lg font-medium text-zinc-900">No playlists yet</h3>
              <p className="text-zinc-500">Create your first playlist to organize your media.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
